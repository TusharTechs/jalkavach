"""Signal models: how an ingress event shows up in complaints, field tests, pharmacy
ORS sales and hospital admissions. The same parameterisation is used by the scenario
generator and by the likelihoods in `posterior.py`. The harness also generates scenarios
from a deliberately *different* complaint process (model mismatch).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.stats import norm, poisson


@dataclass
class SignalParams:
    days: int = 21
    ramp_days: int = 3                      # contamination grows over the first days
    intensities: tuple = (0.05, 0.15, 0.4)  # contaminated fraction at full trace reach
    # complaints (per 1000 residents per day)
    complaint_base: float = 0.03
    complaint_rate: float = 30.0            # extra at full contamination (smell/colour is noticeable); swept in harness
    complaint_k: float = 1.5                # NB dispersion
    complaint_delay_mean: float = 1.5       # days, geometric
    geocode_radius_m: float = 120.0
    # pharmacy ORS / anti-diarrhoeal units per day (aggregated partner pharmacies)
    syndromic_base: float = 6.0
    syndromic_rate: float = 25.0            # per 1000 exposed resident-days
    syndromic_lag: float = 2.0              # days (Bangladesh study: 1-2 days to hospital)
    syndromic_k: float = 8.0
    # hospital admissions (the baseline signal)
    hospital_base: float = 0.2
    hospital_rate: float = 2.5
    hospital_lag: float = 4.0
    # field tests
    kit_sigma: float = 0.08                 # mg/L reading noise for chlorine kits
    sewage_cl_demand: float = 0.6           # mg/L chlorine consumed at full contamination
    h2s_false_pos: float = 0.05
    h2s_k: float = 25.0                     # P(pos) = 1 - (1-fp) exp(-k e)
    prior_event: float = 0.02               # prior P(event in window) for the posterior
    window_days: int = 14


# ----------------------------------------------------------------- kernels

def ramp(tau: np.ndarray, ramp_days: int) -> np.ndarray:
    return np.where(tau < 0, 0.0, np.minimum(1.0, (tau + 1) / ramp_days))


def geometric_pmf(mean: float, n: int) -> np.ndarray:
    q = mean / (1 + mean)
    k = np.arange(n)
    pmf = (1 - q) * q ** k
    return pmf / pmf.sum()


def poisson_pmf(mean: float, n: int) -> np.ndarray:
    pmf = poisson.pmf(np.arange(n), mean)
    return pmf / pmf.sum()


def temporal_profile(t0s: np.ndarray, days: int, ramp_days: int,
                     kernel: np.ndarray | None) -> np.ndarray:
    """F[t0, d] = sum_s ramp(s - t0) * kernel(d - s)  (kernel=None: no delay)."""
    d = np.arange(days)
    R = ramp(d[None, :] - t0s[:, None], ramp_days)      # (T0, D)
    if kernel is None:
        return R
    F = np.zeros_like(R)
    for lag, w in enumerate(kernel):
        if lag >= days:
            break
        F[:, lag:] += w * R[:, : days - lag]
    return F


def geocode_kernel(xy: np.ndarray, radius_m: float) -> np.ndarray:
    """K[n, m] = P(complaint from true location n is geocoded to node m)."""
    d2 = ((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1)
    K = np.exp(-0.5 * d2 / radius_m ** 2)
    return K / K.sum(axis=1, keepdims=True)


# ------------------------------------------------------------------ context

@dataclass
class WardContext:
    """Everything the generator and posterior need about one ward."""
    R: np.ndarray            # (C, N) trace tensor, candidates x receptors
    pop: np.ndarray          # (N,) residents per receptor node
    rho: np.ndarray          # (N,) reporting propensity
    xy: np.ndarray           # (N, 2) metres
    cl_base: np.ndarray      # (N,) baseline residual chlorine mg/L
    prior: np.ndarray        # (C,) exposure prior
    params: SignalParams = field(default_factory=SignalParams)
    K: np.ndarray | None = None

    def __post_init__(self):
        if self.K is None:
            self.K = geocode_kernel(self.xy, self.params.geocode_radius_m)


@dataclass
class FieldTest:
    day: int          # day the sample was taken
    node: int         # receptor index
    failed: bool
    kind: str = "chlorine"   # "chlorine" (read instantly) or "h2s" (read next day)

    @property
    def available_day(self) -> int:
        return self.day + (1 if self.kind == "h2s" else 0)


@dataclass
class Observations:
    complaints: np.ndarray            # (N, D) counts at geocoded nodes, by report day
    syndromic: np.ndarray             # (D,)
    hospital: np.ndarray              # (D,)
    tests: list[FieldTest] = field(default_factory=list)


# ---------------------------------------------------------------- physics

def test_fail_prob(kind: str, cl_base: np.ndarray, e: np.ndarray, p: SignalParams) -> np.ndarray:
    if kind == "chlorine":
        cl = np.maximum(0.0, cl_base * (1 - e) - p.sewage_cl_demand * e)
        return norm.cdf((0.2 - cl) / p.kit_sigma)
    return 1 - (1 - p.h2s_false_pos) * np.exp(-p.h2s_k * e)


def _nb(rng, mean, k):
    mean = np.asarray(mean, dtype=float)
    return rng.negative_binomial(k, k / (k + np.maximum(mean, 1e-12)))


def simulate(ctx: WardContext, event: dict | None, rng: np.random.Generator,
             tests: list[tuple[int, int, str]] | None = None,
             complaint_model: str = "nb") -> Observations:
    """Generate one scenario.

    event: {"c": candidate index, "t0": onset day, "intensity": float} or None.
    tests: list of (day, node, kind) samples to take.
    complaint_model: "nb" matches the posterior's assumptions. "clustered" is a
    mismatched, socially clustered process (complaints arrive in bursts as neighbours
    talk) used to test robustness.
    """
    p = ctx.params
    D, N = p.days, len(ctx.pop)
    days = np.arange(D)
    if event is None:
        e = np.zeros((N, D))
    else:
        e = event["intensity"] * ctx.R[event["c"]][:, None] * ramp(days - event["t0"], p.ramp_days)[None, :]

    # complaints: generated at the true node on the experience day, then delayed and geocoded
    lam = ctx.rho[:, None] * ctx.pop[:, None] / 1000 * (p.complaint_base + p.complaint_rate * e)
    if complaint_model == "clustered":
        burst = rng.gamma(0.5, 2.0, size=lam.shape)        # heavy-tailed social amplification
        counts = rng.poisson(lam * burst)
    else:
        counts = _nb(rng, lam, p.complaint_k)
    delay = geometric_pmf(p.complaint_delay_mean, D)
    obs_c = np.zeros((N, D), dtype=int)
    nz = np.argwhere(counts > 0)
    for n, s in nz:
        k = counts[n, s]
        lags = rng.choice(D, size=k, p=delay)
        locs = rng.choice(N, size=k, p=ctx.K[n])
        for lag, m in zip(lags, locs):
            if s + lag < D:
                obs_c[m, s + lag] += 1

    exposed = (ctx.pop[:, None] / 1000 * e).sum(axis=0)       # exposed resident-days (k)

    def lagged(x, lag_mean):
        ker = poisson_pmf(lag_mean, D)
        out = np.zeros(D)
        for lag, w in enumerate(ker):
            out[lag:] += w * x[: D - lag]
        return out

    syn = _nb(rng, p.syndromic_base + p.syndromic_rate * lagged(exposed, p.syndromic_lag), p.syndromic_k)
    hosp = rng.poisson(p.hospital_base + p.hospital_rate * lagged(exposed, p.hospital_lag))

    field_tests = []
    for day, node, kind in tests or []:
        pf = test_fail_prob(kind, ctx.cl_base[node:node + 1], e[node:node + 1, day], p)[0]
        field_tests.append(FieldTest(day=day, node=node, failed=bool(rng.random() < pf), kind=kind))
    return Observations(complaints=obs_c, syndromic=syn, hospital=hosp, tests=field_tests)


def expected_observations(ctx: WardContext, event: dict | None,
                          tests: list[tuple[int, int, str]] | None = None) -> Observations:
    """Noise-free (expected-value) observations, used for unit tests and explainers."""
    p = ctx.params
    D, N = p.days, len(ctx.pop)
    days = np.arange(D)
    if event is None:
        e = np.zeros((N, D))
    else:
        e = event["intensity"] * ctx.R[event["c"]][:, None] * ramp(days - event["t0"], p.ramp_days)[None, :]
    lam = ctx.rho[:, None] * ctx.pop[:, None] / 1000 * (p.complaint_base + p.complaint_rate * e)
    delay = geometric_pmf(p.complaint_delay_mean, D)
    delayed = np.zeros_like(lam)
    for lag, w in enumerate(delay):
        delayed[:, lag:] += w * lam[:, : D - lag]
    comp = ctx.K.T @ delayed
    exposed = (ctx.pop[:, None] / 1000 * e).sum(axis=0)

    def lagged(x, lag_mean):
        ker = poisson_pmf(lag_mean, D)
        out = np.zeros(D)
        for lag, w in enumerate(ker):
            out[lag:] += w * x[: D - lag]
        return out

    syn = p.syndromic_base + p.syndromic_rate * lagged(exposed, p.syndromic_lag)
    hosp = p.hospital_base + p.hospital_rate * lagged(exposed, p.hospital_lag)
    ft = []
    for day, node, kind in tests or []:
        pf = test_fail_prob(kind, ctx.cl_base[node:node + 1], e[node:node + 1, day], p)[0]
        ft.append(FieldTest(day=day, node=node, failed=bool(pf > 0.5), kind=kind))
    return Observations(complaints=comp, syndromic=syn, hospital=hosp, tests=ft)
