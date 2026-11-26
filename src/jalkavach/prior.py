"""Ingress exposure prior over candidate locations.

The intermittent-supply prior uses pipe age, sewer proximity and the pressure-deficit
exposure feature. The 24x7 ("EPA-style") prior drops the pressure term. Comparing the two
on the same scenarios is ablation 1.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .network import WardNetwork, node_mean_age, node_sewer_share

DEFAULT_WEIGHTS = {"age": 0.4, "sewer": 0.5, "pressure": 0.5}  # tempered: max/min prior ratio ~50x, not ~3000x


def _z(s: pd.Series) -> pd.Series:
    sd = s.std()
    return (s - s.mean()) / sd if sd > 0 else s * 0.0


def prior_features(ward: WardNetwork, deficit: pd.Series) -> pd.DataFrame:
    return pd.DataFrame({
        "age": node_mean_age(ward),
        "sewer": node_sewer_share(ward),
        "pressure": deficit.reindex(ward.nodes.index).fillna(0.0),
    })


def exposure_prior(features: pd.DataFrame, weights: dict | None = None,
                   intermittent: bool = True) -> pd.Series:
    w = dict(DEFAULT_WEIGHTS if weights is None else weights)
    if not intermittent:
        w["pressure"] = 0.0
    score = sum(w[k] * _z(features[k]) for k in w)
    p = np.exp(score - score.max())
    return p / p.sum()


def uniform_prior(index) -> pd.Series:
    return pd.Series(1.0 / len(index), index=index)


def reporting_propensity(ward: WardNetwork, seed: int = 0, low: float = 0.3,
                         high: float = 1.0) -> pd.Series:
    """Synthetic per-node complaint reporting propensity (smartphone/app access proxy).

    A smooth spatial field: one side of the ward reports less. Low-reporting nodes are
    where complaint-led detection is weakest. The equity offset and the per-tier harness
    sensitivity use this.
    """
    rng = np.random.default_rng(seed + 101)
    xy = ward.nodes[["x", "y"]].to_numpy()
    direction = rng.normal(size=2)
    direction /= np.linalg.norm(direction)
    proj = xy @ direction
    proj = (proj - proj.min()) / (np.ptp(proj) or 1.0)
    return pd.Series(low + (high - low) * proj, index=ward.nodes.index)
