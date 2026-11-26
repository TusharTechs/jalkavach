"""Precompute the dashboard replay: one held-out-style scenario, chosen to be *typical*.

Its detection delay and top-3 localisation outcome match the harness medians, so it is
not a best case. The full distribution is in results/RESULTS.md.

    uv run python -m jalkavach.demo        # writes data/demo/replay.json
"""
from __future__ import annotations

import json

import numpy as np

from .config import ROOT
from .context import build_context
from .posterior import combine, loglik_terms
from .routing import expected_information_gain
from .scenario import Scenario, World, physical_risk, sample_gen_params

OUT = ROOT / "data" / "demo" / "replay.json"


def _alert_threshold() -> float:
    p = ROOT / "results" / "summary_ward.json"
    if p.exists():
        return float(json.loads(p.read_text())["thresholds"]["quarterly"]["F"])
    return 0.9


def _run(ctx, ward, meta, seed, risk, thr):
    rng = np.random.default_rng([seed, 1])
    gen = sample_gen_params(ctx, rng, {"complaint_delay_mean": 1.5, "geocode_radius_m": 120.0, "ramp_days": 3})
    event = {"c": int(rng.choice(len(risk), p=risk)), "t0": 6, "intensity": 0.2}
    sc = Scenario(ctx, World(ctx.R, ctx.cl_base, "nominal"), gen, event, seed)
    days = []
    alarm = None
    for day in range(1, sc.days):
        sc.routine_tests(day)
        if day < 2:
            continue
        post = combine(ctx, loglik_terms(ctx, sc.observations(), day))
        if alarm is None and post.p_event >= thr and day >= event["t0"]:
            alarm = day
        days.append((day, post))
    return sc, event, days, alarm


def build(seed_range=range(200, 400)) -> dict:
    ctx, ward, meta = build_context("demo_ward", offline=True)
    import pandas as pd
    risk = physical_risk(ward, pd.Series(meta["deficits"][10.0]))
    thr = _alert_threshold()
    sp = ROOT / "results" / "summary_ward.json"
    med = int(round(json.loads(sp.read_text())["detection"]["quarterly"]["F"]["median_delay"][0])) if sp.exists() else 1
    chosen = None
    for seed in seed_range:          # first scenario with typical outcomes (harness medians)
        sc, event, days, alarm = _run(ctx, ward, meta, seed, risk, thr)
        if alarm is None or alarm - event["t0"] != med:
            continue
        post3 = dict(days)[min(alarm + 3, sc.days - 1)]
        if event["c"] in post3.top_k(3) and event["c"] not in dict(days)[alarm].top_k(1):
            chosen = (seed, sc, event, days, alarm)
            break
    seed, sc, event, days, alarm = chosen
    nodes = ward.nodes
    names = list(nodes.index)
    out = {
        "label": ward.cfg["label"], "seed": seed, "alert_threshold": thr,
        "provenance": ward.provenance,
        "note": (f"Simulated scenario chosen to be typical: its detection delay ({med} days) and its "
                 "localisation (true segment in top 3 three days after the alert) match the "
                 "harness medians. It is not a reconstruction of any real event."),
        "truth": {"node": event["c"], "onset_day": event["t0"]},
        "alarm_day": alarm,
        "nodes": [{"id": n, "lat": float(r.lat), "lon": float(r.lon), "pop": float(r.population),
                   "cl_base": float(ctx.cl_base[i])} for i, (n, r) in enumerate(nodes.iterrows())],
        "pipes": [{"id": pid, "a": names.index(p.start), "b": names.index(p.end), "street": p.street,
                   "diameter_mm": int(p.diameter_mm), "age": int(p.age_years),
                   "sewer": bool(p.sewer_alongside)} for pid, p in ward.pipes.iterrows()],
        "prior": ctx.prior.round(5).tolist(),
        "obs": {
            "complaints": [[int(n), int(d), int(c)] for n, d in np.argwhere(sc.complaints > 0)
                           for c in [sc.complaints[n, d]]],
            "syndromic": sc.syndromic.tolist(), "hospital": sc.hospital.tolist(),
            "tests": [[t.day, t.node, bool(t.failed), t.kind] for t in sc.tests],
            "days": int(sc.days), "n_nodes": int(len(ctx.pop)),
        },
        "days": [],
    }
    for day, post in days:
        eig = expected_information_gain(ctx, post, min(day + 1, sc.days - 1)) if post.p_event >= 0.5 else None
        out["days"].append({
            "day": day, "p_event": round(post.p_event, 4),
            "p_location": post.p_location.round(5).tolist(),
            "top3": post.top_k(3).tolist(),
            "contributions": {k: round(v, 2) for k, v in post.contributions.items()},
            "complaints": {str(i): int(c) for i, c in enumerate(sc.complaints[:, day]) if c},
            "tests": [{"node": t.node, "failed": t.failed, "kind": t.kind} for t in sc.tests if t.day == day],
            "syndromic": int(sc.syndromic[day]), "hospital": int(sc.hospital[day]),
            "suggested_tests": (np.argsort(-eig)[:2].tolist() if eig is not None else []),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out))
    return out


if __name__ == "__main__":
    o = build()
    print(f"seed {o['seed']}: onset day {o['truth']['onset_day']}, alert day {o['alarm_day']}, "
          f"{len(o['days'])} days -> {OUT}")
