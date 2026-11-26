"""Joint Bayesian posterior over (ingress location x onset day x intensity) plus an
explicit no-event hypothesis H0.

  P(H0)          = 1 - pi
  P(c, t0, I)    = pi * prior[c] / (T0 * |I|)

Likelihoods (independent given the hypothesis):
  complaints  ~ NegBin(mu = base_m + I * A[c, m] * F_c[t0, d], k)
  pharmacy    ~ NegBin(mu = base_s + I * S[c] * F_s[t0, d], k_s)
  field tests ~ Bernoulli(test_fail_prob(kind, cl_base, I * R[c, n] * ramp))
Hospital admissions are NOT used here. They are the baseline we compare against.

`loglik_terms` computes per-signal log-likelihood arrays once. `combine` turns any subset
of signals plus any prior into a posterior, so ablations add almost no cost.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.special import logsumexp

from .signals import (Observations, WardContext, geometric_pmf, poisson_pmf, ramp,
                      temporal_profile, test_fail_prob)

SIGNALS = ("complaints", "syndromic", "tests")


@dataclass
class Posterior:
    today: int
    p_event: float
    p_location: np.ndarray        # (C,) P(c | event)
    p_onset: np.ndarray           # (T0,) P(t0 | event)
    onsets: np.ndarray            # (T0,) onset days
    log_bf: float                 # log Bayes factor, event vs no-event
    contributions: dict           # per-signal log-likelihood ratio at the MAP hypothesis
    map_intensity: float = 0.0
    map_onset: int = 0

    def top_k(self, k: int = 3) -> np.ndarray:
        return np.argsort(-self.p_location)[:k]

    def rank_of(self, c: int) -> int:
        return int(np.where(np.argsort(-self.p_location) == c)[0][0])

    def credible_set(self, mass: float = 0.9) -> np.ndarray:
        order = np.argsort(-self.p_location)
        cum = np.cumsum(self.p_location[order])
        return order[: int(np.searchsorted(cum, mass) + 1)]


@dataclass
class LogLik:
    today: int
    onsets: np.ndarray
    intensities: np.ndarray
    terms: dict      # signal -> (ll[I, C, T0], ll0)


def _nb_ll(y: np.ndarray, mu: np.ndarray, k: float) -> np.ndarray:
    """NegBin log-likelihood up to terms constant in mu, summed over the last two axes."""
    mu = np.maximum(mu, 1e-9)
    return (y * np.log(mu) - (k + y) * np.log(k + mu)).sum(axis=(-2, -1))


def loglik_terms(ctx: WardContext, obs: Observations, today: int,
                 signals: tuple[str, ...] = SIGNALS) -> LogLik:
    p = ctx.params
    D = today + 1
    W = min(p.window_days, D)
    onsets = np.arange(D - W, D)
    C, N = ctx.R.shape
    I = np.array(p.intensities, dtype=float)
    terms: dict = {}

    if "complaints" in signals:
        y = obs.complaints[:, :D].astype(float)                      # (M, D)
        w = ctx.rho * ctx.pop / 1000
        base = (ctx.K.T @ (w * p.complaint_base))[:, None]            # (M, 1)
        A1 = (ctx.R * (w * p.complaint_rate)[None, :]) @ ctx.K        # (C, M)
        F = temporal_profile(onsets, D, p.ramp_days, geometric_pmf(p.complaint_delay_mean, D))
        l0 = float(_nb_ll(y, np.broadcast_to(base, y.shape), p.complaint_k))
        # only cells where some hypothesis predicts excess matter; restrict for speed
        active = A1.max(axis=0) > 0
        ya, ba, Aa = y[active], base[active], A1[:, active]
        l0_inactive = float(_nb_ll(y[~active], np.broadcast_to(base[~active], y[~active].shape),
                                   p.complaint_k)) if (~active).any() else 0.0
        part = np.zeros((len(I), C, len(onsets)))
        for ii, inten in enumerate(I):
            for ti in range(len(onsets)):
                mu = ba[None] + inten * Aa[:, :, None] * F[ti][None, None, :]
                part[ii, :, ti] = _nb_ll(ya[None], mu, p.complaint_k) + l0_inactive
        tw = p.complaint_temper
        terms["complaints"] = (part * tw, l0 * tw)

    if "syndromic" in signals and obs.syndromic is not None:
        ys = obs.syndromic[:D].astype(float)
        S1 = p.syndromic_rate * (ctx.R * (ctx.pop / 1000)[None, :]).sum(axis=1)
        Fs = temporal_profile(onsets, D, p.ramp_days, poisson_pmf(p.syndromic_lag, D))
        base = np.full(D, p.syndromic_base)
        l0 = float(_nb_ll(ys[None], base[None], p.syndromic_k))
        mu = (base[None, None, None, :] + I[:, None, None, None] * S1[None, :, None, None]
              * Fs[None, None, :, :])
        part = (ys * np.log(np.maximum(mu, 1e-9)) - (p.syndromic_k + ys) * np.log(p.syndromic_k + mu)).sum(-1)
        terms["syndromic"] = (part, l0)

    if "tests" in signals:
        part = np.zeros((len(I), C, len(onsets)))
        l0 = 0.0
        for t in obs.tests:
            if t.available_day > today:
                continue
            r = ramp(t.day - onsets, p.ramp_days)
            e = I[:, None, None] * ctx.R[:, t.node][None, :, None] * r[None, None, :]
            pf = np.clip(test_fail_prob(t.kind, np.full(e.shape, ctx.cl_base[t.node]), e, p), 1e-6, 1 - 1e-6)
            pf0 = float(np.clip(test_fail_prob(t.kind, np.array([ctx.cl_base[t.node]]),
                                               np.zeros(1), p)[0], 1e-6, 1 - 1e-6))
            part += np.log(pf) if t.failed else np.log1p(-pf)
            l0 += np.log(pf0) if t.failed else np.log1p(-pf0)
        terms["tests"] = (part, l0)

    return LogLik(today=today, onsets=onsets, intensities=I, terms=terms)


def combine(ctx: WardContext, ll: LogLik, use: tuple[str, ...] = SIGNALS,
            prior: np.ndarray | None = None) -> Posterior:
    p = ctx.params
    prior = ctx.prior if prior is None else prior
    C = ctx.R.shape[0]
    shape = (len(ll.intensities), C, len(ll.onsets))
    tot = np.zeros(shape)
    tot0 = 0.0
    used = {k: v for k, v in ll.terms.items() if k in use}
    for part, l0 in used.values():
        tot += part
        tot0 += l0
    log_prior = (np.log(p.prior_event) + np.log(np.maximum(prior, 1e-300))[None, :, None]
                 - np.log(len(ll.onsets) * len(ll.intensities)))
    joint = tot + log_prior
    log_ev = logsumexp(joint)
    log_h0 = tot0 + np.log1p(-p.prior_event)
    log_z = np.logaddexp(log_ev, log_h0)
    post = np.exp(joint - log_ev)
    ii, ci, ti = np.unravel_index(np.argmax(joint), joint.shape)
    return Posterior(
        today=ll.today, p_event=float(np.exp(log_ev - log_z)),
        p_location=post.sum(axis=(0, 2)), p_onset=post.sum(axis=(0, 1)), onsets=ll.onsets,
        log_bf=float(log_ev - (tot0 + np.log(p.prior_event))),
        contributions={k: float(v[0][ii, ci, ti] - v[1]) for k, v in used.items()},
        map_intensity=float(ll.intensities[ii]), map_onset=int(ll.onsets[ti]))


def compute_posterior(ctx: WardContext, obs: Observations, today: int,
                      use: tuple[str, ...] = SIGNALS, prior: np.ndarray | None = None) -> Posterior:
    return combine(ctx, loglik_terms(ctx, obs, today, use), use, prior)
