"""Routing power extension (declared in PREREGISTRATION.md before running): info-gain vs random
on fresh seeds 300,000-300,399. Writes results/routing_extension.json."""
from __future__ import annotations

import json
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import run as H  # noqa: E402

POLS = ("info_gain", "random")


def main(n: int = 400, base: int = 300_000) -> None:
    tau = json.load(open(H.RESULTS / "raw_ward.json"))["tau_F_quarterly"]
    specs = [({"kind": "event", "truth": "physical", "world": i % 10, "seed": base + i}, tau, POLS, 2, 10) for i in range(n)]
    t = time.time()
    with Pool(8, initializer=H._init, initargs=("ward", 10)) as p:
        out = p.map(H.run_routing, specs, chunksize=2)
    rows = [o for o in out if o.get("alarm_day") is not None and all(o.get(k) for k in POLS) and o[POLS[0]]["top3"] != 0]
    tests = {k: np.array([21 if r[k]["top3"] is None else r[k]["top3"] for r in rows]) for k in POLS}
    hit = {k: (tests[k] < 21).astype(float) for k in POLS}
    rng = np.random.default_rng(7)
    idx = rng.integers(0, len(rows), (5000, len(rows)))
    d = hit["info_gain"] - hit["random"]
    boot = d[idx].mean(1)
    res = {"n_specs": n, "seeds": [base, base + n - 1], "n_usable": len(rows), "seconds": round(time.time() - t),
           "reached_top3": {k: float(hit[k].mean()) for k in POLS},
           "diff_reached": [float(d.mean()), float(np.quantile(boot, 0.025)), float(np.quantile(boot, 0.975))],
           "tests_median": {k: float(np.median(tests[k])) for k in POLS},
           "tests_mean": {k: float(tests[k].mean()) for k in POLS}}
    (H.RESULTS / "routing_extension.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
