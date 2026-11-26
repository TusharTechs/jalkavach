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
    rho = reporting_propensity(ward.nodes[["x", "y"]].to_numpy(), ward.nodes.index,
                               seed=cfg.get("seed", 0)).to_numpy()
    ctx = WardContext(R=R, pop=ward.nodes["population"].to_numpy(), rho=rho,
                      xy=ward.nodes[["x", "y"]].to_numpy(), cl_base=np.asarray(cl),
                      prior=prior, params=params or SignalParams())
    meta = {"features": feats, "deficits": deficits, "provenance": ward.provenance}
    return ctx, ward, meta


def build_benchmark_context(name: str = "Net3", target_nn_m: float = 60.0,
                            population: float = 20000.0,
                            params: SignalParams | None = None) -> tuple[WardContext, list[str]]:
    """Robustness topology: an EPANET example network with 24x7 supply and a uniform prior.

    Coordinates are rescaled so the median nearest-neighbour spacing matches a city ward.
    Population is spread in proportion to base demand.
    """
    from .network import load_benchmark

    path = CACHE / f"bench_{name}.npz"
    wn = load_benchmark(name)
    wn.options.time.duration = 48 * 3600
    wn.options.time.quality_timestep = 300
    juncs = list(wn.junction_name_list)
    xy = np.array([wn.get_node(j).coordinates for j in juncs], dtype=float)
    d = np.linalg.norm(xy[:, None] - xy[None], axis=-1)
    np.fill_diagonal(d, np.inf)
    xy = xy * (target_nn_m / np.median(d.min(axis=1)))
    q = np.array([max(wn.get_node(j).demand_timeseries_list[0].base_value, 0.0)
                  if wn.get_node(j).demand_timeseries_list else 0.0 for j in juncs])
    pop = population * q / q.sum()
    if path.exists():
        z = np.load(path)
        R, cl = z["R"], z["cl"]
    else:
        R = H.trace_tensor(wn, juncs, juncs)
        cl = H.baseline_chlorine(wn, juncs, 0.5, -0.8, None, days=2).to_numpy()
        np.savez(path, R=R, cl=cl)
    rho = reporting_propensity(xy, juncs, seed=3).to_numpy()
    ctx = WardContext(R=R, pop=pop, rho=rho, xy=xy, cl_base=np.asarray(cl),
                      prior=np.full(len(juncs), 1.0 / len(juncs)), params=params or SignalParams())
    return ctx, juncs
