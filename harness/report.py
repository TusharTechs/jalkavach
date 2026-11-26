"""Turn raw harness output into the pre-registered metrics, tables and figures.

    uv run python -m harness.report [--tag ward] [--tag net3]
"""
from __future__ import annotations

import argparse
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from harness.run import FIRST_DAY, RESULTS, calibrate  # noqa: E402

D = 21
POST_METHODS = ["F", "C", "T", "S", "F24", "Funif", "Fpsi5", "Fpsi15"]
EARS_METHODS = {"H": "ears_H", "CC": "ears_CC", "S_ears": "ears_S"}
LABEL = {"F": "Fusion (JalKavach)", "C": "Complaints only", "T": "Field tests only",
         "S": "Pharmacy only", "H": "Hospital admissions (baseline)",
         "CC": "Complaint-count exceedance (baseline)", "S_ears": "Pharmacy exceedance (baseline)",
         "F24": "Fusion, 24x7 prior", "Funif": "Fusion, uniform prior",
         "Fpsi5": "Fusion, 5 psi prior", "Fpsi15": "Fusion, 15 psi prior"}
RNG = np.random.default_rng(7)


def boot_ci(x, stat=np.median, n=2000):
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    if len(x) == 0:
        return (np.nan, np.nan, np.nan)
    bs = [stat(RNG.choice(x, len(x))) for _ in range(n)]
    return (float(stat(x)), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)))


def fmt(ci, nd=1, pct=False):
    m, lo, hi = ci
    if pct:
        return f"{100 * m:.0f}% [{100 * lo:.0f}–{100 * hi:.0f}]"
    return f"{m:.{nd}f} [{lo:.{nd}f}–{hi:.{nd}f}]"


def series(r, m):
    if m in EARS_METHODS:
        return np.array(r[EARS_METHODS[m]], dtype=float)
    return np.array(r["p_event"][m], dtype=float)


def detect_day(r, m, thr):
    s = series(r, m)
    start = max(r["event"]["t0"], FIRST_DAY)
    hit = np.where(s[start:] >= thr)[0]
    return int(start + hit[0]) if len(hit) else None


def analyse(tag: str) -> dict:
    raw = json.loads((RESULTS / f"raw_{tag}.json").read_text())
    recs = raw["scenarios"]
    nulls = [r for r in recs if r["kind"] == "null"]
    events = [r for r in recs if r["kind"] == "event"]
    methods = [m for m in POST_METHODS if m in nulls[0]["p_event"]] + list(EARS_METHODS)
    thr = {b: {m: calibrate(nulls, EARS_METHODS.get(m, m), budget, m in EARS_METHODS)
               for m in methods} for b, budget in (("quarterly", 1.0), ("monthly", 3.0))}
    out = {"tag": tag, "n_null": len(nulls), "n_event": len(events), "thresholds": thr}

    rows = []
    for r in events:
        t0 = r["event"]["t0"]
        row = {"set": r["set"], "seed": r["seed"], "t0": t0, "c": r["event"]["c"],
               "intensity": r["event"]["intensity"], "ramp_days": r["ramp_days"],
               "delay_mean": r["complaint_delay_mean"], "radius": r["geocode_radius_m"],
               "exposure_rho": r["exposure_rho"], "n_complaints": r["n_complaints"]}
        for b in thr:
            for m in methods:
                d = detect_day(r, m, thr[b][m])
                row[f"{b}:{m}"] = d
        dF = row["quarterly:F"]
        for m in [k for k in ("F", "F24", "Funif", "C", "Fpsi5", "Fpsi15") if k in r["rank"]]:
            for off in (0, 3):
                day = None if dF is None else min(dF + off, D - 1)
                rk = r["rank"][m][day] if day is not None else None
                row[f"top3@{off}:{m}"] = None if rk is None else float(rk < 3)
                row[f"top1@{off}:{m}"] = None if rk is None else float(rk < 1)
            row[f"cover@0:{m}"] = None if dF is None else float(bool(r["cover"][m][dF]))
        row["top3@0:CC"] = None if dF is None else float(bool(r["cc_hit"][dF]))
        row["top3@3:CC"] = None if dF is None else float(bool(r["cc_hit"][min(dF + 3, D - 1)]))
        rows.append(row)
    df = pd.DataFrame(rows)
    df.to_csv(RESULTS / f"events_{tag}.csv", index=False)
    main = df[df["set"] == "main"]

    def delay(sub, b, m):
        d = sub[f"{b}:{m}"].astype(float)
        return np.where(d.isna(), D, d) - sub["t0"]

    det = {}
    for b in thr:
        det[b] = {}
        for m in methods:
            dl = delay(main, b, m)
            det[b][m] = {"median_delay": boot_ci(dl), "detected": boot_ci(main[f"{b}:{m}"].notna().astype(float), np.mean)}
        lead = delay(main, b, "H") - delay(main, b, "F")
        det[b]["lead_F_vs_H"] = boot_ci(lead)
        det[b]["lead_F_vs_H_mean"] = boot_ci(lead, np.mean)
        det[b]["lead_F_vs_CC"] = boot_ci(delay(main, b, "CC") - delay(main, b, "F"))
        singles = {m: np.median(delay(main, b, m)) for m in ("C", "T", "S") if m in methods}
        best = min(singles, key=singles.get)
        det[b]["best_single"] = best
        det[b]["gain_F_vs_best_single"] = boot_ci(delay(main, b, best) - delay(main, b, "F"))
        det[b]["detect_rate_diff_F_vs_CC"] = boot_ci(main[f"{b}:F"].notna().astype(float)
                                                     - main[f"{b}:CC"].notna().astype(float), np.mean)
        det[b]["censored_H"] = float(main[f"{b}:H"].isna().mean())
        det[b]["censored_F"] = float(main[f"{b}:F"].isna().mean())
    out["detection"] = det

    loc = {}
    for setname in ("main", "uniform_truth"):
        sub = df[(df["set"] == setname) & df["quarterly:F"].notna()]
        if not len(sub):
            continue
        loc[setname] = {"n": int(len(sub))}
        for m in ("F", "F24", "Funif", "C", "Fpsi5", "Fpsi15", "CC"):
            for off in (0, 3):
                col = f"top3@{off}:{m}"
                if col in sub:
                    loc[setname][f"top3@{off}:{m}"] = boot_ci(sub[col].astype(float), np.mean)
            if f"top1@3:{m}" in sub:
                loc[setname][f"top1@3:{m}"] = boot_ci(sub[f"top1@3:{m}"].astype(float), np.mean)
        for a, bb in (("F", "F24"), ("F", "Funif"), ("F", "C"), ("F", "CC")):
            if f"top3@0:{bb}" not in sub:
                continue
            for off in (0, 3):
                diff = sub[f"top3@{off}:{a}"].astype(float) - sub[f"top3@{off}:{bb}"].astype(float)
                loc[setname][f"diff_top3@{off}:{a}-{bb}"] = boot_ci(diff, np.mean)
        loc[setname]["coverage90:F"] = boot_ci(sub["cover@0:F"].astype(float), np.mean)
    out["localisation"] = loc

    # equity: detection delay by tercile of the reporting propensity of the exposed population
    q = main.dropna(subset=["exposure_rho"]).copy()
    q["tier"] = pd.qcut(q["exposure_rho"], 3, labels=["low", "mid", "high"])
    out["equity"] = {str(t): {"median_delay_F": boot_ci(delay(g, "quarterly", "F")),
                              "detected_F": float(g["quarterly:F"].notna().mean()),
                              "median_delay_C": boot_ci(delay(g, "quarterly", "C"))}
                     for t, g in q.groupby("tier", observed=True)}

    sweeps = {}
    for s in sorted(x for x in df["set"].unique() if x.startswith("sweep:")):
        g = df[df["set"] == s]
        gd = g[g["quarterly:F"].notna()]
        sweeps[s] = {"n": int(len(g)), "median_delay_F": boot_ci(delay(g, "quarterly", "F")),
                     "detected_F": float(g["quarterly:F"].notna().mean()),
                     "top3@3:F": boot_ci(gd["top3@3:F"].astype(float), np.mean) if len(gd) else None}
    out["sweeps"] = sweeps

    # calibration / reliability (location probabilities at t0+5, main set)
    ps, ys = [], []
    for r in events:
        if r["set"] != "main" or not r["reliability_day_p"]:
            continue
        p = np.array(r["reliability_day_p"])
        y = np.zeros_like(p)
        y[r["event"]["c"]] = 1
        ps.append(p)
        ys.append(y)
    if ps:
        P, Y = np.concatenate(ps), np.concatenate(ys)
        bins = np.array([0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0001])
        idx = np.digitize(P, bins) - 1
        rel = []
        for b in range(len(bins) - 1):
            msk = idx == b
            if msk.sum() >= 5:
                rel.append({"bin": f"{bins[b]:.2f}-{min(bins[b + 1], 1):.2f}", "mean_pred": float(P[msk].mean()),
                            "observed": float(Y[msk].mean()), "n": int(msk.sum())})
        out["reliability"] = rel

    # routing ablation
    rt = raw.get("routing") or []
    if rt:
        res = {}
        alarmed = [r for r in rt if r["alarm_day"] is not None]
        need = [r for r in alarmed if r["info_gain"]["top3"] != 0]
        res["n_alarmed"] = len(alarmed)
        res["n_truth_not_in_top3_at_alarm"] = len(need)
        for pol in ("info_gain", "random", "nearest"):
            v = np.array([np.nan if r[pol]["top3"] is None else r[pol]["top3"] for r in need], dtype=float)
            res[pol] = {"reached_top3": float(np.mean(~np.isnan(v))) if len(v) else np.nan,
                        "median_tests_to_top3": boot_ci(np.where(np.isnan(v), 21, v)),
                        "mean_tests_to_top3": boot_ci(np.where(np.isnan(v), 21, v), np.mean)}
            v1 = np.array([np.nan if r[pol]["top1"] is None else r[pol]["top1"] for r in alarmed], dtype=float)
            res[pol]["reached_top1"] = float(np.mean(~np.isnan(v1)))
        out["routing"] = res

    # failures
    fail = main[(main["quarterly:F"].isna()) | (main["top3@3:F"] == 0)]
    fail.to_csv(RESULTS / f"failures_{tag}.csv", index=False)
    out["n_failures"] = int(len(fail))

    _figures(tag, df, main, nulls, methods, thr, out)
    (RESULTS / f"summary_{tag}.json").write_text(json.dumps(out, indent=1, default=float))
    return out


def _figures(tag, df, main, nulls, methods, thr, out):
    figdir = RESULTS / "figures"
    figdir.mkdir(exist_ok=True)
    # 1. detection-delay CDF at the quarterly budget
    fig, ax = plt.subplots(figsize=(6.4, 4))
    for m, st in (("F", "-"), ("C", "--"), ("S", ":"), ("T", "-."), ("CC", (0, (1, 1))), ("H", "-")):
        if f"quarterly:{m}" not in main:
            continue
        d = main[f"quarterly:{m}"].astype(float)
        dl = np.sort(np.where(d.isna(), np.inf, d) - main["t0"])
        xs = np.arange(0, 15)
        ax.plot(xs, [(dl <= x).mean() for x in xs], linestyle=st, lw=2.2 if m in ("F", "H") else 1.4,
                color="black" if m == "H" else None, label=LABEL[m])
    ax.set_xlabel("days after onset")
    ax.set_ylabel("share of events detected")
    ax.set_title("Detection at ≤1 false alarm per ward per quarter")
    ax.legend(fontsize=7, frameon=False)
    ax.grid(alpha=.3)
    fig.tight_layout()
    fig.savefig(figdir / f"detection_cdf_{tag}.png", dpi=160)
    plt.close(fig)

    # 2. reliability diagram
    rel = out.get("reliability")
    if rel:
        fig, ax = plt.subplots(figsize=(4.2, 4.2))
        x = [r["mean_pred"] for r in rel]
        y = [r["observed"] for r in rel]
        ax.plot([0, 1], [0, 1], color="grey", lw=1)
        ax.plot(x, y, "o-")
        ax.set_xscale("symlog", linthresh=0.05)
        ax.set_yscale("symlog", linthresh=0.05)
        ax.set_xlabel("predicted P(location)")
        ax.set_ylabel("observed frequency")
        ax.set_title("Reliability (5 days after onset)")
        ax.grid(alpha=.3)
        fig.tight_layout()
        fig.savefig(figdir / f"reliability_{tag}.png", dpi=160)
        plt.close(fig)

    # 3. false-alarm vs detection-delay trade-off
    main_recs = [r for r in json.loads((RESULTS / f"raw_{tag}.json").read_text())["scenarios"]
                 if r["set"] == "main"]
    fig, ax = plt.subplots(figsize=(6.4, 4))
    for m in ("F", "C", "CC", "H"):
        key = EARS_METHODS.get(m, m)
        pts = []
        for budget in (0.25, 0.5, 1, 2, 3, 6):
            t = calibrate(nulls, key, budget, m in EARS_METHODS)
            dl = []
            for r in main_recs:
                dd = detect_day(r, m, t)
                dl.append((D if dd is None else dd) - r["event"]["t0"])
            pts.append((budget, np.median(dl)))
        ax.plot([p[0] for p in pts], [p[1] for p in pts], "o-", label=LABEL[m],
                color="black" if m == "H" else None)
    ax.set_xscale("log")
    ax.set_xticks([0.25, 0.5, 1, 2, 3, 6])
    ax.set_xticklabels(["0.25", "0.5", "1", "2", "3", "6"])
    ax.minorticks_off()
    ax.set_xlabel("false alarms per ward per quarter")
    ax.set_ylabel("median days from onset to alarm")
    ax.legend(fontsize=7, frameon=False)
    ax.grid(alpha=.3)
    ax.set_title("Earlier alarms cost more false alarms")
    fig.tight_layout()
    fig.savefig(figdir / f"tradeoff_{tag}.png", dpi=160)
    plt.close(fig)


def markdown(summaries: list[dict]) -> str:
    L = ["# Evaluation results", "",
         "Generated by `harness/report.py` from `results/raw_*.json`. The design is in `harness/PREREGISTRATION.md`.",
         "Every number comes from **simulated, held-out scenarios**: perturbed networks, a mismatched complaint process, and a truth model different from the engine's prior. None of it is field data. 95% bootstrap confidence intervals are in brackets.", ""]
    for s in summaries:
        tag = s["tag"]
        L += [f"## Topology: {tag}", "", f"Scenarios: {s['n_event']} event, {s['n_null']} no-event.", ""]
        for b in ("quarterly", "monthly"):
            d = s["detection"][b]
            budget = "≤1 false alarm per ward per quarter" if b == "quarterly" else "≤1 false alarm per ward per month"
            L += [f"### Detection at {budget}", "", "| Method | Median days from onset to alarm | Detected within 21 days |", "|---|---|---|"]
            for m in [k for k in LABEL if k in d]:
                L.append(f"| {LABEL[m]} | {fmt(d[m]['median_delay'])} | {fmt(d[m]['detected'], pct=True)} |")
            L += ["", f"- **Lead of fusion over the hospital-only baseline (median, paired):** {fmt(d['lead_F_vs_H'])} days. Mean: {fmt(d['lead_F_vs_H_mean'])}. Events the hospital baseline never caught within 21 days: {100 * d['censored_H']:.0f}%; fusion: {100 * d['censored_F']:.0f}% (counted as day 21).",
                  f"- **Lead over complaint-count exceedance:** {fmt(d['lead_F_vs_CC'])} days. Detection-rate difference (fusion minus complaint-count exceedance, paired): {fmt(d['detect_rate_diff_F_vs_CC'], pct=True)}.",
                  f"- **Fusion vs. the best single signal ({LABEL[d['best_single']]}):** {fmt(d['gain_F_vs_best_single'])} days earlier (median, paired).", ""]
        for setname, title in (("main", "true location from the physical risk model"), ("uniform_truth", "true location uniform")):
            loc = s["localisation"].get(setname)
            if not loc:
                continue
            L += [f"### Localisation ({title}; n={loc['n']} detected events)", "",
                  "| Method | Top-3 at alarm | Top-3 three days later |", "|---|---|---|"]
            for m in ("F", "F24", "Funif", "Fpsi5", "Fpsi15", "C", "CC"):
                if f"top3@0:{m}" in loc:
                    lab = LABEL.get(m, m) if m != "CC" else "Complaint centroid (baseline)"
                    L.append(f"| {lab} | {fmt(loc[f'top3@0:{m}'], pct=True)} | {fmt(loc[f'top3@3:{m}'], pct=True)} |")
            if "diff_top3@3:F-F24" in loc:
                L += ["", f"- **Ablation 1, intermittent prior minus 24x7 prior (top-3, 3 days after alarm):** {fmt(loc['diff_top3@3:F-F24'], nd=3)}",
                      f"- **Intermittent prior minus uniform prior:** {fmt(loc['diff_top3@3:F-Funif'], nd=3)}",
                      f"- **Fusion minus complaints-only (top-3, 3 days after alarm):** {fmt(loc['diff_top3@3:F-C'], nd=3)}",
                      f"- **Fusion minus complaint centroid (top-3, 3 days after alarm):** {fmt(loc['diff_top3@3:F-CC'], nd=3)}",
                      f"- **Coverage of the 90% credible set at alarm:** {fmt(loc['coverage90:F'], pct=True)}"]
            L.append("")
        if s.get("routing"):
            r = s["routing"]
            L += [f"### Ablation 3: field-test routing after an alarm ({r['n_truth_not_in_top3_at_alarm']} of {r['n_alarmed']} alarmed events where the truth was not already in the top 3; 2 routed tests/day for up to 10 days)", "",
                  "| Policy | Reached top 3 | Tests to top 3 (median; 21 = never) | Tests to top 3 (mean) |", "|---|---|---|---|"]
            for pol in ("info_gain", "random", "nearest"):
                L.append(f"| {pol} | {100 * r[pol]['reached_top3']:.0f}% | {fmt(r[pol]['median_tests_to_top3'])} | {fmt(r[pol]['mean_tests_to_top3'])} |")
            L.append("")
        if s.get("equity"):
            L += ["### Equity: detection by reporting propensity of the exposed population", "",
                  "| Tier | Fusion median days to alarm | Fusion detected | Complaints-only median days |", "|---|---|---|---|"]
            for t, v in s["equity"].items():
                L.append(f"| {t} | {fmt(v['median_delay_F'])} | {100 * v['detected_F']:.0f}% | {fmt(v['median_delay_C'])} |")
            L.append("")
        if s.get("sweeps"):
            L += ["### Sensitivity sweeps (generator fixed at the value; engine unchanged)", "",
                  "| Setting | Fusion median days to alarm | Detected | Top-3 three days after alarm |", "|---|---|---|---|"]
            for k, v in s["sweeps"].items():
                t3 = fmt(v["top3@3:F"], pct=True) if v["top3@3:F"] else "–"
                L.append(f"| {k.replace('sweep:', '')} | {fmt(v['median_delay_F'])} | {100 * v['detected_F']:.0f}% | {t3} |")
            L.append("")
        L += [f"Failures (missed, or truth outside the top 3 three days after alarm): {s['n_failures']} scenarios, listed in `results/failures_{tag}.csv`.", ""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", action="append")
    a = ap.parse_args()
    tags = a.tag or ["ward"]
    sums = [analyse(t) for t in tags]
    (RESULTS / "RESULTS.md").write_text(markdown(sums))
    print((RESULTS / "RESULTS.md").read_text())


if __name__ == "__main__":
    main()
