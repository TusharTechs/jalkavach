"""Joint Bayesian posterior over (ingress location x onset day x intensity) plus an
explicit no-event hypothesis H0.

  P(H0)          = 1 - pi
  P(c, t0, I)    = pi * prior[c] / (T0 * |I|)

Likelihoods (independent given the hypothesis):
  complaints  ~ NegBin(mu = base_m + A_I[c, m] * F_c[t0, d], k)
  syndromic   ~ NegBin(mu = base_s + I * S[c] * F_s[t0, d], k_s)
  field tests ~ Bernoulli(test_fail_prob(kind, cl_base, I * R[c, n] * ramp))
Hospital admissions are NOT used here: they are the baseline we compare against.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.special import logsumexp

from .signals import (Observations, WardContext, geometric_pmf, poisson_pmf, ramp,
                      temporal_profile, test_fail_prob)


@dataclass
class Posterior:
    today: int
    p_event: float
    p_location: np.ndarray        # (C,) P(c | event)
    p_onset: np.ndarray           # (T0,) P(t0 | event)
    onsets: np.ndarray            # (T0,) onset days
    log_bf: float                 # log Bayes factor event vs no-event
    contributions: dict           # per-signal log-likelihood contributions at the MAP

    def top_k(self, k: int = 3) -> np.ndarray:
        return np.argsort(-self.p_location)[:k]


def _nb_ll(y: np.ndarray, mu: np.ndarray, k: float) -> np.ndarray:
    """NegBin log-likelihood up to terms constant in mu, summed over the last two axes."""
    mu = np.maximum(mu, 1e-9)
    return (y * np.log(mu) - (k + y) * np.log(k + mu)).sum(axis=(-2, -1))


def compute_posterior(ctx: WardContext, obs: Observations, today: int,
                      use: tuple[str, ...] = ("complaints", "syndromic", "tests"),
                      prior: np.ndarray | None = None) -> Posterior:
    p = ctx.params
    D = today + 1
    W = min(p.window_days, D)
    onsets = np.arange(D - W, D)
    prior = ctx.prior if prior is None else prior
    C, N = ctx.R.shape
    I = np.array(p.intensities)

    # ll[i, c, t] for event hypotheses, ll0 for H0
    ll = np.zeros((len(I), C, len(onsets)))
    ll0 = 0.0
    contrib = {}

    if "complaints" in use:
        y = obs.complaints[:, :D].astype(float)                      # (M, D)
        w = ctx.rho * ctx.pop / 1000                                  # (N,)
        base = (ctx.K.T @ (w * p.complaint_base))[:, None]            # (M, 1)
        A1 = (ctx.R * (w * p.complaint_rate)[None, :]) @ ctx.K        # (C, M)
        F = temporal_profile(onsets, D, p.ramp_days, geometric_pmf(p.complaint_delay_mean, D))
        l0 = float(_nb_ll(y, np.broadcast_to(base, y.shape), p.complaint_k))
        part = np.zeros_like(ll)
        for ii, inten in enumerate(I):
            for ti in range(len(onsets)):
                mu = base[None] + inten * A1[:, :, None] * F[ti][None, None, :]   # (C, M, D)
                part[ii, :, ti] = _nb_ll(y[None], mu, p.complaint_k)
        ll += part
        ll0 += l0
        contrib["complaints"] = (part, l0)

    if "syndromic" in use and obs.syndromic is not None:
        ys = obs.syndromic[:D].astype(float)
        S1 = p.syndromic_rate * (ctx.R * (ctx.pop / 1000)[None, :]).sum(axis=1)  # (C,)
        Fs = temporal_profile(onsets, D, p.ramp_days, poisson_pmf(p.syndromic_lag, D))
        base = np.full(D, p.syndromic_base)
        l0 = float(_nb_ll(ys[None], base[None], p.syndromic_k))
        mu = base[None, None, None, :] + I[:, None, None, None] * S1[None, :, None, None] * Fs[None, None, :, :]
        part = (ys * np.log(np.maximum(mu, 1e-9)) - (p.syndromic_k + ys) * np.log(p.syndromic_k + mu)).sum(-1)
        ll += part
        ll0 += l0
        contrib["syndromic"] = (part, l0)

    if "tests" in use:
        part = np.zeros_like(ll)
        l0 = 0.0
        for t in obs.tests:
            if t.available_day > today:
                continue
            r = ramp(t.day - onsets, p.ramp_days)                             # (T0,)
            e = I[:, None, None] * ctx.R[:, t.node][None, :, None] * r[None, None, :]
            pf = np.clip(test_fail_prob(t.kind, np.full(e.shape, ctx.cl_base[t.node]), e, p), 1e-6, 1 - 1e-6)
            pf0 = float(np.clip(test_fail_prob(t.kind, np.array([ctx.cl_base[t.node]]), np.zeros(1), p)[0], 1e-6, 1 - 1e-6))
            part += np.log(pf) if t.failed else np.log1p(-pf)
            l0 += np.log(pf0) if t.failed else np.log1p(-pf0)
        ll += part
        ll0 += l0
        contrib["tests"] = (part, l0)

    log_prior = (np.log(p.prior_event) + np.log(np.maximum(prior, 1e-300))[None, :, None]
                 - np.log(len(onsets) * len(I)))
    joint = ll + log_prior
    log_ev = logsumexp(joint)
    log_h0 = ll0 + np.log1p(-p.prior_event)
    log_z = np.logaddexp(log_ev, log_h0)
    post = np.exp(joint - log_ev)                     # conditional on event
    p_event = float(np.exp(log_ev - log_z))
    ii, ci, ti = np.unravel_index(np.argmax(joint), joint.shape)
    contributions = {k: float(v[0][ii, ci, ti] - v[1]) for k, v in contrib.items()}
    return Posterior(today=today, p_event=p_event, p_location=post.sum(axis=(0, 2)),
                     p_onset=post.sum(axis=(0, 1)), onsets=onsets,
                     log_bf=float(log_ev - (ll0 + np.log(p.prior_event))),
                     contributions=contributions)
