"""Evaluation harness. See harness/PREREGISTRATION.md for the design.

    uv run python -m harness.run            # full run (~minutes on 8 cores)
    uv run python -m harness.run --quick    # smoke run

Writes results/raw_*.json, and harness/report.py turns them into tables and plots.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from multiprocessing import Pool

import numpy as np
import pandas as pd

from jalkavach.baselines import complaint_centroid_topk, ears_c2
from jalkavach.config import CACHE, ROOT, load_config
from jalkavach.context import build_benchmark_context, build_context
from jalkavach.posterior import combine, loglik_terms
from jalkavach.prior import exposure_prior
from jalkavach.routing import choose_tests
from jalkavach.scenario import Scenario, World, perturbed_worlds, physical_risk, sample_gen_params

RESULTS = ROOT / "results"
FIRST_DAY = 2
LOC_METHODS = ("F", "F24", "Funif", "C", "Fpsi5", "Fpsi15")

# ------------------------------------------------------------ worker state
G: dict = {}


def _init(topology: str, k_worlds: int):
    if topology == "ward":
        ctx, ward, meta = build_context("demo_ward", offline=True)
        cfg = load_config("demo_ward")
        feats = meta["features"]
        priors = {
            "F": ctx.prior,
            "F24": exposure_prior(feats, intermittent=False).to_numpy(),
            "Funif": np.full(len(ctx.prior), 1 / len(ctx.prior)),
        }
        for psi in (5.0, 15.0):
            f2 = feats.copy()
            f2["pressure"] = pd.Series(meta["deficits"][psi])
            priors[f"Fpsi{int(psi)}"] = exposure_prior(f2).to_numpy()
        wpath = CACHE / f"worlds_{k_worlds}.npz"
        if wpath.exists():
            z = np.load(wpath)
            worlds = [World(R=z[f"R{i}"], cl_base=z[f"cl{i}"], label=f"perturbed-{i}") for i in range(k_worlds)]
        else:
            clc = cfg["chlorine"]
            worlds = perturbed_worlds(ward, k_worlds, seed=99, dose=clc["dose_mg_l"], bulk=clc["bulk_per_day"])
            np.savez(wpath, **{f"R{i}": w.R for i, w in enumerate(worlds)},
                     **{f"cl{i}": w.cl_base for i, w in enumerate(worlds)})
        risk = physical_risk(ward, pd.Series(meta["deficits"][10.0]))
    else:
        ctx, _ = build_benchmark_context("Net3")
        priors = {"F": ctx.prior}
        worlds = [World(R=ctx.R, cl_base=ctx.cl_base, label="nominal")]
        risk = np.full(len(ctx.prior), 1 / len(ctx.prior))
    G.update(ctx=ctx, priors=priors, worlds=worlds, risk=risk, topology=topology)


def _make_scenario(spec: dict) -> Scenario:
    ctx = G["ctx"]
    rng = np.random.default_rng([spec["seed"], 1])
    gen = sample_gen_params(ctx, rng, spec.get("overrides"))
    world = G["worlds"][spec["world"] % len(G["worlds"])]
    event = None
    if spec["kind"] == "event":
        pr = G["risk"] if spec["truth"] == "physical" else np.full(len(ctx.prior), 1 / len(ctx.prior))
        event = {"c": int(rng.choice(len(pr), p=pr)), "t0": int(rng.integers(3, 11)),
                 "intensity": float(rng.uniform(0.03, 0.5))}
    return Scenario(ctx, world, gen, event, seed=spec["seed"])


def run_scenario(spec: dict) -> dict:
    ctx, priors = G["ctx"], G["priors"]
    sc = _make_scenario(spec)
    D = sc.days
    methods = {"F": (("complaints", "syndromic", "tests"), "F"),
               "C": (("complaints",), "F"), "T": (("tests",), "F"), "S": (("syndromic",), "F")}
    for extra in ("F24", "Funif", "Fpsi5", "Fpsi15"):
        if extra in priors:
            methods[extra] = (("complaints", "syndromic", "tests"), extra)
    p_event = {m: [0.0] * D for m in methods}
    rank = {m: [None] * D for m in methods if m in LOC_METHODS}
    cover = {m: [None] * D for m in methods if m in LOC_METHODS}
    ptrue = {m: [None] * D for m in methods if m in LOC_METHODS}
    cc_hit = [None] * D
    truth = sc.event["c"] if sc.event else None
    reliab = []
    for day in range(1, D):
        sc.routine_tests(day)
        if day < FIRST_DAY:
            continue
        ll = loglik_terms(ctx, sc.observations(), day)
        for m, (use, pk) in methods.items():
            post = combine(ctx, ll, use, priors[pk])
            p_event[m][day] = post.p_event
            if truth is not None and m in rank:
                rank[m][day] = post.rank_of(truth)
                cover[m][day] = bool(truth in post.credible_set(0.9))
                ptrue[m][day] = float(post.p_location[truth])
                if m == "F" and day == sc.event["t0"] + 5:
                    reliab = post.p_location.round(5).tolist()
        if truth is not None:
            cc_hit[day] = bool(truth in complaint_centroid_topk(sc.complaints, ctx.xy, day))
    p = ctx.params
    base_comp = float((ctx.rho * ctx.pop / 1000 * p.complaint_base).sum())
    rec = {
        **{k: v for k, v in spec.items() if k != "overrides"},
        "overrides": spec.get("overrides"),
        "event": sc.event, "ramp_days": sc.gen.ramp_days,
        "complaint_delay_mean": sc.gen.sp.complaint_delay_mean,
        "geocode_radius_m": sc.gen.sp.geocode_radius_m,
        "complaint_rate": sc.gen.sp.complaint_rate,
        "p_event": p_event, "rank": rank, "cover": cover, "ptrue": ptrue, "cc_hit": cc_hit,
        "ears_H": ears_c2(sc.hospital, history_mean=p.hospital_base).tolist(),
        "ears_CC": ears_c2(sc.complaints.sum(axis=0), history_mean=base_comp).tolist(),
        "ears_S": ears_c2(sc.syndromic, history_mean=p.syndromic_base).tolist(),
        "n_tests": len(sc.tests), "n_complaints": int(sc.complaints.sum()),
        "exposure_rho": sc.exposure_weighted_rho() if sc.event else None,
        "reliability_day_p": reliab,
    }
    return rec


def run_routing(args: tuple) -> dict:
    spec, tau_f, policies, per_day, max_days = args
    ctx = G["ctx"]
    out = {"seed": spec["seed"], "event": None, "alarm_day": None}
    probe = _make_scenario(spec)
    out["event"] = probe.event
    truth = probe.event["c"]
    # find the alarm day under routine testing only
    alarm = None
    for day in range(1, probe.days):
        probe.routine_tests(day)
        if day >= FIRST_DAY and combine(ctx, loglik_terms(ctx, probe.observations(), day)).p_event >= tau_f:
            if day >= probe.event["t0"]:
                alarm = day
                break
    out["alarm_day"] = alarm
    if alarm is None:
        return out
    for pol in policies:
        sc = _make_scenario(spec)               # identical world, common random numbers
        rng = np.random.default_rng([spec["seed"], 5])
        for day in range(1, alarm + 1):
            sc.routine_tests(day)
        post = combine(ctx, loglik_terms(ctx, sc.observations(), alarm))
        n_routed, hit_top3, hit_top1 = 0, None, None
        if truth in post.top_k(3):
            hit_top3 = 0
        if truth in post.top_k(1):
            hit_top1 = 0
        tested: set[int] = set()
        for day in range(alarm + 1, min(alarm + 1 + max_days, sc.days)):
            sc.routine_tests(day)
            for n in choose_tests(pol, ctx, post, sc.complaints, day, per_day, rng, tested):
                sc.take_test(day, n)
                tested.add(n)
                n_routed += 1
            post = combine(ctx, loglik_terms(ctx, sc.observations(), day))
            if hit_top3 is None and truth in post.top_k(3):
                hit_top3 = n_routed
            if hit_top1 is None and truth in post.top_k(1):
                hit_top1 = n_routed
        out[pol] = {"top3": hit_top3, "top1": hit_top1, "routed": n_routed}
    return out


def calibrate(records: list[dict], key: str, budget_per_90d: float, is_ears: bool) -> float:
    """Smallest threshold with P(any alarm in a 21-day null run) * 90/21 <= budget."""
    mx = []
    for r in records:
        s = np.array(r[key] if is_ears else r["p_event"][key], dtype=float)[FIRST_DAY:]
        mx.append(np.max(s))
    mx = np.sort(np.array(mx))
    allowed = budget_per_90d * 21 / 90
    for thr in np.unique(np.concatenate([mx, [np.inf]])):
        if np.mean(mx >= thr) <= allowed:
            return float(thr)
    return float("inf")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--topology", default="ward", choices=["ward", "net3"])
    a = ap.parse_args()
    q = a.quick
    n_ev, n_unif, n_null = (30, 10, 40) if q else (240, 120, 400)
    n_sweep, n_route = (8, 10) if q else (60, 120)
    k_worlds = 3 if q else 10
    if a.topology == "net3":
        n_ev, n_unif, n_null, n_sweep, n_route = (20, 0, 30, 0, 0) if q else (150, 0, 250, 0, 0)
    RESULTS.mkdir(exist_ok=True)
    tag = a.topology + ("_quick" if q else "")
    seed = 1000 if q else 100_000   # quick = development seeds; full run = fresh held-out seeds
    specs = []
    for i in range(n_ev):
        specs.append({"set": "main", "kind": "event", "truth": "physical", "world": i, "seed": seed + i})
    for i in range(n_unif):
        specs.append({"set": "uniform_truth", "kind": "event", "truth": "uniform", "world": i, "seed": seed + 10_000 + i})
    for i in range(n_null):
        specs.append({"set": "null", "kind": "null", "truth": None, "world": i, "seed": seed + 20_000 + i})
    sweep = {"complaint_delay_mean": [0.5, 1.5, 3.0], "geocode_radius_m": [60.0, 120.0, 250.0]}
    j = 30_000
    for key, vals in sweep.items():
        for v in vals:
            for i in range(n_sweep):
                specs.append({"set": f"sweep:{key}={v}", "kind": "event", "truth": "physical",
                              "world": i, "seed": seed + j, "overrides": {key: v}})
                j += 1
    t = time.time()
    print(f"[{tag}] {len(specs)} scenarios on {a.workers} workers ...", flush=True)
    with Pool(a.workers, initializer=_init, initargs=(a.topology, k_worlds)) as pool:
        recs = pool.map(run_scenario, specs, chunksize=4)
        print(f"  scenarios done in {time.time() - t:.0f}s", flush=True)
        nulls = [r for r in recs if r["kind"] == "null"]
        tau_f = calibrate(nulls, "F", 1.0, False)
        routing = []
        if n_route:
            t = time.time()
            rspecs = [({"kind": "event", "truth": "physical", "world": i, "seed": seed + 50_000 + i},
                       tau_f, ("info_gain", "random", "nearest"), 2, 10) for i in range(n_route)]
            routing = pool.map(run_routing, rspecs, chunksize=2)
            print(f"  routing done in {time.time() - t:.0f}s", flush=True)
    with open(RESULTS / f"raw_{tag}.json", "w") as f:
        json.dump({"scenarios": recs, "routing": routing, "tau_F_quarterly": tau_f,
                   "k_worlds": k_worlds, "topology": a.topology}, f)
    print(f"  wrote results/raw_{tag}.json")


if __name__ == "__main__":
    main()
