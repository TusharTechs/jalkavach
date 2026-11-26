"""Assets for the animated front end: flow directions, particle trips, plume arrival times,
3D building context. Cached in data/cache/visual_<ward>.json.
"""
from __future__ import annotations

import json

import numpy as np

from . import hydraulics as H
from .config import CACHE
from .network import WardNetwork, supply_on_mask


def build_visual(ward: WardNetwork, n_particles: int = 420, seed: int = 11) -> dict:
    path = CACHE / f"visual_{ward.cfg['name']}.json"
    if path.exists():
        return json.loads(path.read_text())
    on = supply_on_mask(ward.cfg["supply"]["windows"])
    fl = H.supply_flows(ward.wn, on)
    names = list(ward.nodes.index)
    idx = {n: i for i, n in enumerate(names)}
    lat, lon = ward.nodes["lat"].to_numpy(), ward.nodes["lon"].to_numpy()
    pipes = []
    out_edges: dict[int, list[tuple[int, int, float, float]]] = {}
    for pid, p in ward.pipes.iterrows():
        f = float(fl.loc[pid, "flow"]) if pid in fl.index else 0.0
        vel = max(float(fl.loc[pid, "velocity"]) if pid in fl.index else 0.0, 0.02)
        a, b = idx[p.start], idx[p.end]
        if f < 0:
            a, b = b, a
        pipes.append({"id": pid, "from": a, "to": b, "flow_lps": round(abs(f) * 1000, 3),
                      "velocity": round(vel, 3), "length": round(float(p.length), 1)})
        if abs(f) > 1e-6:
            out_edges.setdefault(a, []).append((b, len(pipes) - 1, abs(f), float(p.length) / vel))
    src = idx[ward.provenance["source_node"]]
    rng = np.random.default_rng(seed)
    trips = []
    loop = 0.0
    for _ in range(n_particles):
        node, t, path_, ts = src, 0.0, [[lon[src], lat[src]]], [0.0]
        for _ in range(60):
            nxt = out_edges.get(node)
            if not nxt:
                break
            w = np.array([e[2] for e in nxt])
            b, _, _, dur = nxt[int(rng.choice(len(nxt), p=w / w.sum()))]
            t += dur
            node = b
            path_.append([lon[b], lat[b]])
            ts.append(t)
        if len(path_) > 2:
            trips.append({"p": [[round(x, 6), round(y, 6)] for x, y in path_], "t": [round(v, 1) for v in ts]})
            loop = max(loop, t)
    A = H.trace_arrivals(ward.wn, ward.junctions, ward.junctions)
    A = np.where(np.isfinite(A), A, -1).round(2)
    bpath = CACHE / f"buildings_{ward.cfg['name']}.json"
    out = {"pipes": pipes, "trips": trips, "trip_loop_s": loop, "source": src,
           "arrival_h": A.tolist(),
           "buildings": json.loads(bpath.read_text()) if bpath.exists() else []}
    path.write_text(json.dumps(out))
    return out
