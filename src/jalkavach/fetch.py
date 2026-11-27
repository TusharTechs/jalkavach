"""Fetch and cache all open-data assets for a ward (needs network once).

    uv run python -m jalkavach.fetch demo_ward

Landmarks are stored with GENERIC labels only (e.g. "Park 2", "Medical store A"), never
real business names, so a demo complaint can never name a real shop.
"""
from __future__ import annotations

import json
import sys
from collections import Counter

from .config import CACHE, load_config
from .network import build_ward_network

KINDS = {
    ("amenity", "school"): ("School", "स्कूल"),
    ("amenity", "college"): ("College", "कॉलेज"),
    ("amenity", "community_centre"): ("Community hall", "सामुदायिक भवन"),
    ("amenity", "hospital"): ("Hospital", "अस्पताल"),
    ("amenity", "clinic"): ("Clinic", "क्लिनिक"),
    ("amenity", "doctors"): ("Clinic", "क्लिनिक"),
    ("amenity", "pharmacy"): ("Medical store", "मेडिकल स्टोर"),
    ("shop", "chemist"): ("Medical store", "मेडिकल स्टोर"),
    ("amenity", "toilets"): ("Public toilet", "सार्वजनिक शौचालय"),
    ("leisure", "park"): ("Park", "पार्क"),
    ("leisure", "playground"): ("Playground", "खेल मैदान"),
    ("man_made", "water_tower"): ("Water tank", "पानी की टंकी"),
    ("man_made", "water_tank"): ("Water tank", "पानी की टंकी"),
}
# Places of worship are deliberately never used as landmarks: a contamination demo must not
# place "sewage in the water" next to any community's shrine.


def fetch_pois(cfg: dict) -> list[dict]:
    import osmnx as ox

    tags = {"amenity": True, "leisure": ["park", "playground"], "man_made": ["water_tower", "water_tank"],
            "shop": ["chemist"]}
    g = ox.features_from_point(tuple(cfg["center"]), tags=tags, dist=cfg["dist_m"])
    out, counts = [], Counter()
    for _, r in g.iterrows():
        kind = None
        for (k, v), lab in KINDS.items():
            if k in r and r.get(k) == v:
                kind = lab
                break
        if kind is None:
            continue
        c = r.geometry.centroid
        counts[kind[0]] += 1
        out.append({"kind": kind[0], "name_hi": kind[1], "lat": c.y, "lon": c.x})
    # generic, de-duplicated display names: "Park 1", "Medical store A"
    seen = Counter()
    for p in out:
        seen[p["kind"]] += 1
        n = seen[p["kind"]]
        if counts[p["kind"]] == 1:
            p["name"] = p["kind"]
        elif p["kind"] == "Medical store":
            p["name"] = f"Medical store {chr(64 + n)}"
        else:
            p["name"] = f"{p['kind']} {n}"
    return out


def fetch_buildings(cfg: dict) -> list[dict]:
    import osmnx as ox

    g = ox.features_from_point(tuple(cfg["center"]), tags={"building": True}, dist=cfg["dist_m"] + 150)
    g = g[g.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    feats = []
    for _, r in g.iterrows():
        polys = [r.geometry] if r.geometry.geom_type == "Polygon" else list(r.geometry.geoms)
        lv = r.get("building:levels")
        try:
            levels = float(lv) if lv is not None and str(lv) != "nan" else None
        except ValueError:
            levels = None
        for p in polys:
            feats.append({"c": [[round(x, 6), round(y, 6)] for x, y in p.exterior.coords], "l": levels})
    return feats


def main(name: str = "demo_ward") -> None:
    cfg = load_config(name)
    ward = build_ward_network(cfg)                     # caches OSM graph + elevations
    print(f"network: {len(ward.junctions)} junctions, {len(ward.pipes)} pipes")
    pois = fetch_pois(cfg)
    (CACHE / f"pois_{cfg['name']}.json").write_text(json.dumps(pois, ensure_ascii=False, indent=0))
    print(f"landmarks: {len(pois)}", Counter(p["kind"] for p in pois).most_common())
    b = fetch_buildings(cfg)
    (CACHE / f"buildings_{cfg['name']}.json").write_text(json.dumps(b))
    print(f"buildings: {len(b)}")


if __name__ == "__main__":
    main(*sys.argv[1:])
