"""Hydraulic, water-quality and source-trace simulations (EPANET 2.2 via WNTR).

Physics note: EPANET is a full-pipe solver. We do not simulate pipes draining and
refilling. Intermittent supply is represented by a tank-head schedule plus
pressure-dependent demand (PDD), which yields near-zero-pressure windows between supply
periods. Hours spent below a pressure level form an *exposure feature* for ingress
(informed by Kumpel & Nelson's Hubli-Dharwad field work). It is not a physical
threshold.
"""
from __future__ import annotations

import copy
import os
import tempfile
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd
import wntr

from .config import PSI_TO_M


@dataclass
class HydraulicResult:
    pressure: pd.DataFrame   # time x junction (m)
    demand: pd.DataFrame     # time x junction (m3/s)
    warnings: list[str]


def run_hydraulics(wn: wntr.network.WaterNetworkModel, junctions: list[str] | None = None,
                   prefix: str | None = None) -> HydraulicResult:
    wn = copy.deepcopy(wn)
    wn.options.quality.parameter = "NONE"
    junctions = junctions or list(wn.junction_name_list)
    with tempfile.TemporaryDirectory() as td, warnings.catch_warnings(record=True) as ws:
        warnings.simplefilter("always")
        res = wntr.sim.EpanetSimulator(wn).run_sim(
            file_prefix=os.path.join(td, prefix or "hyd"), version=2.2)
    return HydraulicResult(pressure=res.node["pressure"][junctions],
                           demand=res.node["demand"][junctions],
                           warnings=[str(w.message) for w in ws])


def check_hydraulics(h: HydraulicResult, min_pressure_m: float = -1.0) -> None:
    """Raise if the solution is physically implausible (negative pressures, unbalanced)."""
    pmin = float(h.pressure.min().min())
    if pmin < min_pressure_m:
        raise ValueError(f"pressure below {min_pressure_m} m (min={pmin:.2f})")
    bad = [w for w in h.warnings if "unbalanced" in w.lower() or "disconnected" in w.lower()]
    if bad:
        raise ValueError(f"hydraulic warnings: {bad}")


def low_pressure_hours(h: HydraulicResult, threshold_psi: float = 10.0) -> pd.Series:
    """Hours per day each junction spends below `threshold_psi`."""
    thr = threshold_psi * PSI_TO_M
    t = h.pressure.index.to_numpy()
    p = h.pressure[t < t[0] + 86400]          # one supply day, no double-counted endpoint
    dt_h = (t[1] - t[0]) / 3600
    below = (p.values < thr) * dt_h
    return pd.Series(below.sum(axis=0), index=h.pressure.columns)


def _quality_run(wn, td: str, tag: str):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return wntr.sim.EpanetSimulator(wn).run_sim(file_prefix=os.path.join(td, tag), version=2.2)


def trace_tensor(wn: wntr.network.WaterNetworkModel, candidates: list[str],
                 receptors: list[str], progress: bool = False) -> np.ndarray:
    """R[c, n] = demand-weighted fraction of water consumed at receptor n that passed
    through candidate ingress node c over one supply day (EPANET source trace).

    The trace starts at t=0. Flow between windows is near zero, so transport effectively
    begins when supply restarts. Flow reversals are handled by EPANET itself.
    """
    base = copy.deepcopy(wn)
    base.options.quality.parameter = "TRACE"
    R = np.zeros((len(candidates), len(receptors)))
    with tempfile.TemporaryDirectory() as td:
        for i, c in enumerate(candidates):
            base.options.quality.trace_node = c
            res = _quality_run(base, td, f"tr{i}")
            q = res.node["quality"][receptors].to_numpy() / 100.0
            d = np.clip(res.node["demand"][receptors].to_numpy(), 0, None)
            vol = d.sum(axis=0)
            R[i] = np.where(vol > 0, (q * d).sum(axis=0) / np.where(vol > 0, vol, 1), 0.0)
            if progress and i % 20 == 0:
                print(f"  trace {i + 1}/{len(candidates)}")
    return np.clip(R, 0.0, 1.0)


def baseline_chlorine(wn: wntr.network.WaterNetworkModel, receptors: list[str],
                      dose_mg_l: float = 0.5, bulk_per_day: float = -0.8,
                      pipe_ages: pd.Series | None = None, days: int = 3) -> pd.Series:
    """Demand-weighted residual chlorine (mg/L) at each receptor on the last simulated day.

    Low residual at network ends is normal under intermittent supply. The kit likelihood
    uses this baseline so a low reading is not treated as proof of ingress.
    """
    m = copy.deepcopy(wn)
    m.options.time.duration = days * 86400
    m.options.quality.parameter = "CHEMICAL"
    for _, r in m.reservoirs():
        r.initial_quality = dose_mg_l
    for name, p in m.pipes():
        age = float(pipe_ages.get(name, 0.0)) if pipe_ages is not None else 0.0
        # older cast-iron mains exert more chlorine demand (lumped into the bulk term)
        p.bulk_coeff = (bulk_per_day - age / 30.0) / 86400
    with tempfile.TemporaryDirectory() as td:
        res = _quality_run(m, td, "cl")
    q = res.node["quality"][receptors]
    d = res.node["demand"][receptors].clip(lower=0)
    last = q.index >= (days - 1) * 86400
    vol = d[last].sum()
    return ((q[last] * d[last]).sum() / vol.replace(0, np.nan)).fillna(0.0)


def pressure_deficit(h: HydraulicResult, threshold_psi: float = 10.0) -> pd.Series:
    """Pressure-deficit hours per day: sum over time of max(0, thr - p) / thr * dt.

    Unlike raw hours-below-threshold (saturated for every node between supply windows),
    this keeps contrast between tail ends and nodes near the tank. It is an exposure
    feature, swept over 5/10/15 psi in the harness.
    """
    thr = threshold_psi * PSI_TO_M
    t = h.pressure.index.to_numpy()
    p = h.pressure[t < t[0] + 86400].to_numpy()
    dt_h = (t[1] - t[0]) / 3600
    return pd.Series((np.clip(thr - p, 0, None) / thr * dt_h).sum(axis=0),
                     index=h.pressure.columns)


def supply_flows(wn: wntr.network.WaterNetworkModel, on_hours: np.ndarray) -> pd.DataFrame:
    """Mean signed flow (m3/s) and velocity (m/s) per pipe while supply is on."""
    m = copy.deepcopy(wn)
    m.options.quality.parameter = "NONE"
    with tempfile.TemporaryDirectory() as td, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = wntr.sim.EpanetSimulator(m).run_sim(file_prefix=os.path.join(td, "fl"), version=2.2)
    q = res.link["flowrate"]
    v = res.link["velocity"]
    hrs = (q.index.to_numpy() // 3600).astype(int) % 24
    on = on_hours[hrs]
    return pd.DataFrame({"flow": q[on].mean(), "velocity": v[on].abs().mean()})


def trace_arrivals(wn: wntr.network.WaterNetworkModel, candidates: list[str], receptors: list[str],
                   threshold_pct: float = 1.0) -> np.ndarray:
    """A[c, n] = hours (within one supply day) until water from c first reaches n (inf if never)."""
    base = copy.deepcopy(wn)
    base.options.quality.parameter = "TRACE"
    A = np.full((len(candidates), len(receptors)), np.inf)
    with tempfile.TemporaryDirectory() as td:
        for i, c in enumerate(candidates):
            base.options.quality.trace_node = c
            res = _quality_run(base, td, f"ar{i}")
            q = res.node["quality"][receptors].to_numpy()
            t = res.node["quality"].index.to_numpy() / 3600
            hit = q >= threshold_pct
            first = np.where(hit.any(axis=0), hit.argmax(axis=0), -1)
            A[i] = np.where(first >= 0, t[np.maximum(first, 0)], np.inf)
    return A
