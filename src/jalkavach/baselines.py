"""Baselines: EARS-C2-style exceedance detectors and a complaint-centroid localiser."""
from __future__ import annotations

import numpy as np


def ears_c2(series: np.ndarray, baseline_days: int = 7, guard: int = 2,
            min_sd_floor: float = 0.2, history_mean: float | None = None) -> np.ndarray:
    """EARS C2 statistic per day: (x_t - mean) / sd over [t-guard-baseline, t-guard).

    For sparse count series the sd floor is sqrt(max(mean, floor)), so a run of zeros
    cannot make the statistic explode. Days before the series starts are filled with
    `history_mean`, the long-run base rate a city knows from its records. Without it,
    days lacking history get -inf.
    """
    x = np.asarray(series, dtype=float)
    out = np.full(len(x), -np.inf)
    for t in range(len(x)):
        lo, hi = t - guard - baseline_days, t - guard
        if lo < 0:
            if history_mean is None:
                continue
            b = np.concatenate([np.full(-lo, float(history_mean)), x[: max(hi, 0)]])[-baseline_days:]
        else:
            b = x[lo:hi]
        mu = b.mean()
        sd = max(b.std(ddof=1) if len(b) > 1 else 0.0, np.sqrt(max(mu, min_sd_floor)))
        out[t] = (x[t] - mu) / sd
    return out


def complaint_centroid_topk(complaints: np.ndarray, xy: np.ndarray, today: int,
                            window: int = 5, k: int = 3) -> np.ndarray:
    """Top-k nodes nearest the count-weighted centroid of recent complaints."""
    lo = max(0, today - window + 1)
    w = complaints[:, lo:today + 1].sum(axis=1).astype(float)
    if w.sum() == 0:
        return np.arange(k)
    c = (w[:, None] * xy).sum(axis=0) / w.sum()
    return np.argsort(np.linalg.norm(xy - c, axis=1))[:k]
