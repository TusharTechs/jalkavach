"""Assemble a WardContext from a config: network, hydraulics, trace tensor, chlorine,
prior. Results are cached to data/cache so the demo runs offline.
"""
from __future__ import annotations

import hashlib
import json

import numpy as np
import pandas as pd

from . import hydraulics as H
from .config import CACHE, load_config
from .network import WardNetwork, build_ward_network
from .prior import exposure_prior, prior_features, reporting_propensity
from .signals import SignalParams, WardContext


def _key(cfg: dict) -> str:
    return hashlib.sha1(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:10]


def build_context(name: str = "demo_ward", threshold_psi: float = 10.0,
                  intermittent_prior: bool = True, offline: bool = False,
                  params: SignalParams | None = None) -> tuple[WardContext, WardNetwork, dict]:
    cfg = load_config(name)
    ward = build_ward_network(cfg, offline=offline)
    key = _key(cfg)
    path = CACHE / f"physics_{cfg['name']}_{key}.npz"
    if path.exists():
        z = np.load(path, allow_pickle=True)
        R, cl, deficits = z["R"], z["cl"], z["deficits"].item()
    else:
        h = H.run_hydraulics(ward.wn, ward.junctions)
        H.check_hydraulics(h)
        R = H.trace_tensor(ward.wn, ward.junctions, ward.junctions)
        clc = cfg.get("chlorine", {})
        cl = H.baseline_chlorine(ward.wn, ward.junctions, clc.get("dose_mg_l", 0.5),
                                 clc.get("bulk_per_day", -0.8), ward.pipes["age_years"]).to_numpy()
        deficits = {psi: H.pressure_deficit(h, psi).to_dict() for psi in (5.0, 10.0, 15.0)}
        np.savez(path, R=R, cl=cl, deficits=np.array(deficits, dtype=object))
    deficit = pd.Series(deficits[float(threshold_psi)])
    feats = prior_features(ward, deficit)
    prior = exposure_prior(feats, intermittent=intermittent_prior).to_numpy()
    rho = reporting_propensity(ward, seed=cfg.get("seed", 0)).to_numpy()
    ctx = WardContext(R=R, pop=ward.nodes["population"].to_numpy(), rho=rho,
                      xy=ward.nodes[["x", "y"]].to_numpy(), cl_base=np.asarray(cl),
                      prior=prior, params=params or SignalParams())
    meta = {"features": feats, "deficits": deficits, "provenance": ward.provenance}
    return ctx, ward, meta
