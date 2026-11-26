"""Held-out scenario generation for the evaluation harness.

The generator deliberately differs from the engine's assumptions (see
harness/PREREGISTRATION.md):
- perturbed networks (roughness, diameters, demand), so the true trace tensor and
  chlorine are not the ones the engine uses;
- a clustered complaint process, with different rates, delays and geocoding error;
- continuous intensity, random ramp and pharmacy lag;
- true locations drawn from a physical risk model whose functional form differs from
  the engine's prior.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from . import hydraulics as H
from .network import WardNetwork, node_mean_age, node_sewer_share
from .signals import (FieldTest, Observations, SignalParams, WardContext, geocode_kernel,
                      geometric_pmf, poisson_pmf, ramp, test_fail_prob)

DIAMETER_TIERS_M = [0.1, 0.15, 0.2, 0.25, 0.3]


# ------------------------------------------------------------------- worlds

@dataclass
class World:
    """Generator-side truth for one (possibly perturbed) network."""
    R: np.ndarray
    cl_base: np.ndarray
    label: str


def perturbed_worlds(ward: WardNetwork, k: int, seed: int, dose: float, bulk: float) -> list[World]:
    rng = np.random.default_rng(seed)
    worlds = []
    for i in range(k):
        wn = copy.deepcopy(ward.wn)
        for name, pipe in wn.pipes():
            if name == "P_SUPPLY":
                continue
            pipe.roughness *= rng.uniform(0.7, 1.3)
            if rng.random() < 0.2:
                j = int(np.argmin([abs(pipe.diameter - d) for d in DIAMETER_TIERS_M]))
                j = int(np.clip(j + rng.choice([-1, 1]), 0, len(DIAMETER_TIERS_M) - 1))
                pipe.diameter = DIAMETER_TIERS_M[j]
        for _, jn in wn.junctions():
            jn.demand_timeseries_list[0].base_value *= rng.uniform(0.7, 1.3)
        h = H.run_hydraulics(wn, ward.junctions)
        H.check_hydraulics(h)
        R = H.trace_tensor(wn, ward.junctions, ward.junctions)
        cl = H.baseline_chlorine(wn, ward.junctions, dose, bulk, ward.pipes["age_years"]).to_numpy()
        worlds.append(World(R=R, cl_base=cl, label=f"perturbed-{i}"))
    return worlds


def physical_risk(ward: WardNetwork, deficit: pd.Series) -> np.ndarray:
    """Truth-side ingress risk: multiplicative, unlike the engine's additive prior."""
    sew = node_sewer_share(ward).to_numpy()
    age = node_mean_age(ward).fillna(30).to_numpy()
    d = deficit.reindex(ward.nodes.index).fillna(0).to_numpy()
    z = (d - d.mean()) / (d.std() or 1)
    risk = sew * (1 / (1 + np.exp(-z))) * np.sqrt(age / 60) + 0.02
    return risk / risk.sum()


# --------------------------------------------------------- generator params

@dataclass
class GenParams:
    """Truth-side signal parameters for one scenario."""
    sp: SignalParams          # same fields as the engine, but drawn from the mismatch distribution
    rho: np.ndarray
    K: np.ndarray
    ramp_days: int
    complaint_model: str = "clustered"


def sample_gen_params(ctx: WardContext, rng: np.random.Generator, overrides: dict | None = None) -> GenParams:
    base = ctx.params
    o = overrides or {}
    sp = replace(
        base,
        complaint_rate=base.complaint_rate * o.get("complaint_rate_mult", rng.uniform(0.5, 2.0)),
        complaint_delay_mean=o.get("complaint_delay_mean", rng.uniform(0.5, 3.0)),
        geocode_radius_m=o.get("geocode_radius_m", rng.uniform(60, 250)),
        syndromic_rate=base.syndromic_rate * rng.uniform(0.5, 2.0),
        syndromic_lag=rng.uniform(1.0, 4.0),
    )
    rho = np.clip(ctx.rho * rng.uniform(0.6, 1.4, size=len(ctx.rho)), 0.05, 1.2)
    K = geocode_kernel(ctx.xy, sp.geocode_radius_m)
    return GenParams(sp=sp, rho=rho, K=K, ramp_days=int(o.get("ramp_days", rng.integers(1, 6))),
                     complaint_model=o.get("complaint_model", "clustered"))


# ----------------------------------------------------------------- scenario

class Scenario:
    """One held-out scenario. Field tests can be requested interactively (routing).

    Test outcomes use common random numbers: the same (day, node, kind) always gives the
    same result within a scenario, so routing policies are compared on identical worlds.
    """

    def __init__(self, ctx: WardContext, world: World, gen: GenParams,
                 event: dict | None, seed: int):
        self.ctx, self.world, self.gen, self.event, self.seed = ctx, world, gen, event, seed
        rng = np.random.default_rng(seed)
        p = gen.sp
        D, N = p.days, len(ctx.pop)
        days = np.arange(D)
        if event is None:
            self.e = np.zeros((N, D))
        else:
            self.e = (event["intensity"] * world.R[event["c"]][:, None]
                      * ramp(days - event["t0"], gen.ramp_days)[None, :])
        lam = gen.rho[:, None] * ctx.pop[:, None] / 1000 * (p.complaint_base + p.complaint_rate * self.e)
        if gen.complaint_model == "clustered":
            counts = rng.poisson(lam * rng.gamma(0.5, 2.0, size=lam.shape))
        else:
            counts = rng.negative_binomial(p.complaint_k, p.complaint_k / (p.complaint_k + np.maximum(lam, 1e-12)))
        delay = geometric_pmf(p.complaint_delay_mean, D)
        obs_c = np.zeros((N, D), dtype=int)
        for n, s in np.argwhere(counts > 0):
            k = counts[n, s]
            lags = rng.choice(D, size=k, p=delay)
            locs = rng.choice(N, size=k, p=gen.K[n])
            for lag, m in zip(lags, locs):
                if s + lag < D:
                    obs_c[m, s + lag] += 1
        self.complaints = obs_c
        exposed = (ctx.pop[:, None] / 1000 * self.e).sum(axis=0)
        self.exposed = exposed

        def lagged(x, lag_mean):
            ker = poisson_pmf(lag_mean, D)
            out = np.zeros(D)
            for lag, w in enumerate(ker):
                out[lag:] += w * x[: D - lag]
            return out

        mu_s = p.syndromic_base + p.syndromic_rate * lagged(exposed, p.syndromic_lag)
        self.syndromic = rng.negative_binomial(p.syndromic_k, p.syndromic_k / (p.syndromic_k + mu_s))
        self.hospital = rng.poisson(p.hospital_base + p.hospital_rate * lagged(exposed, p.hospital_lag))
        self.tests: list[FieldTest] = []

    @property
    def days(self) -> int:
        return self.gen.sp.days

    def take_test(self, day: int, node: int, kind: str = "chlorine") -> FieldTest:
        kind_code = 0 if kind == "chlorine" else 1
        u = np.random.default_rng([self.seed, day, node, kind_code]).random()
        pf = test_fail_prob(kind, self.world.cl_base[node:node + 1], self.e[node:node + 1, day], self.gen.sp)[0]
        t = FieldTest(day=day, node=node, failed=bool(u < pf), kind=kind)
        self.tests.append(t)
        return t

    def routine_tests(self, day: int, per_day: int = 1, triggered_max: int = 2) -> None:
        """1 random tap per day, plus next-day tests at up to 2 geocoded complaint nodes."""
        rng = np.random.default_rng([self.seed, day, 7])
        for n in rng.choice(len(self.ctx.pop), size=per_day, replace=False):
            self.take_test(day, int(n))
        if day >= 1:
            prev = np.argwhere(self.complaints[:, day - 1] > 0).ravel()
            if len(prev):
                for n in rng.choice(prev, size=min(triggered_max, len(prev)), replace=False):
                    self.take_test(day, int(n))

    def observations(self) -> Observations:
        return Observations(complaints=self.complaints, syndromic=self.syndromic,
                            hospital=self.hospital, tests=list(self.tests))

    def exposure_weighted_rho(self) -> float:
        w = (self.ctx.pop * self.e.sum(axis=1))
        return float((w * self.gen.rho).sum() / w.sum()) if w.sum() > 0 else float("nan")
