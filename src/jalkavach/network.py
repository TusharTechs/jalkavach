"""Build a hydraulic network model for a ward.

Streets come from OpenStreetMap (real). The water mains, sewers, diameters and pipe
ages are synthetic but constrained to those streets, and seeded for reproducibility.
Elevations come from the Open-Meteo elevation API (Copernicus DEM, ~90 m), cached
locally, with a flat fallback flagged in the metadata.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
import pandas as pd
import wntr

from .config import CACHE


@dataclass
class WardNetwork:
    wn: wntr.network.WaterNetworkModel
    nodes: pd.DataFrame          # junction attributes, indexed by junction name
    pipes: pd.DataFrame          # pipe attributes, indexed by pipe name
    cfg: dict
    provenance: dict = field(default_factory=dict)

    @property
    def junctions(self) -> list[str]:
        return list(self.nodes.index)


# --------------------------------------------------------------------------- OSM

def _graph_cache_path(cfg: dict) -> str:
    lat, lon = cfg["center"]
    return str(CACHE / f"osm_{cfg['name']}_{lat:.4f}_{lon:.4f}_{cfg['dist_m']}.graphml")


def fetch_street_graph(cfg: dict, offline: bool = False) -> nx.MultiDiGraph:
    import osmnx as ox

    path = _graph_cache_path(cfg)
    if os.path.exists(path):
        return ox.load_graphml(path)
    if offline:
        raise FileNotFoundError(f"No cached OSM graph at {path}")
    g = ox.graph_from_point(tuple(cfg["center"]), dist=cfg["dist_m"],
                            network_type=cfg.get("network_type", "drive_service"),
                            simplify=True)
    os.makedirs(CACHE, exist_ok=True)
    ox.save_graphml(g, path)
    return g


def fetch_elevations(lats: np.ndarray, lons: np.ndarray, cache_key: str,
                     offline: bool = False) -> tuple[np.ndarray, str]:
    """Return elevations (m) and a provenance string."""
    path = CACHE / f"elev_{cache_key}.json"
    if path.exists():
        data = json.loads(path.read_text())
        return np.array(data["elevation"]), data["source"]
    if not offline:
        try:
            import requests

            elev: list[float] = []
            for i in range(0, len(lats), 100):
                r = requests.get(
                    "https://api.open-meteo.com/v1/elevation",
                    params={"latitude": ",".join(f"{x:.6f}" for x in lats[i:i + 100]),
                            "longitude": ",".join(f"{x:.6f}" for x in lons[i:i + 100])},
                    timeout=30,
                )
                r.raise_for_status()
                elev.extend(r.json()["elevation"])
            source = "Open-Meteo elevation API (Copernicus DEM GLO-90)"
            path.write_text(json.dumps({"elevation": elev, "source": source}))
            return np.array(elev, dtype=float), source
        except Exception as exc:  # pragma: no cover - network dependent
            print(f"[network] elevation fetch failed ({exc}); using flat fallback")
    return np.full(len(lats), 550.0), "flat fallback (550 m) - synthetic"


# ----------------------------------------------------------------- construction

_CORNERS = {
    "north_west": (1, -1), "north_east": (1, 1),
    "south_west": (-1, -1), "south_east": (-1, 1),
}


def _pick_source(nodes: pd.DataFrame, corner: str) -> str:
    sy, sx = _CORNERS[corner]
    score = sy * nodes["y"] + sx * nodes["x"]
    return str(score.idxmax())


def build_ward_network(cfg: dict, offline: bool = False) -> WardNetwork:
    import osmnx as ox

    rng = np.random.default_rng(cfg.get("seed", 0))
    g = fetch_street_graph(cfg, offline=offline)
    gp = ox.project_graph(g)
    ug = ox.convert.to_undirected(gp)
    # keep the largest connected component
    comp = max(nx.connected_components(ug), key=len)
    ug = ug.subgraph(comp).copy()

    # ---- nodes
    node_ids = list(ug.nodes)
    names = {n: f"J{n}" for n in node_ids}
    xy = np.array([[ug.nodes[n]["x"], ug.nodes[n]["y"]] for n in node_ids])
    latlon = np.array([[g.nodes[n]["y"], g.nodes[n]["x"]] for n in node_ids])
    lat0, lon0 = cfg["center"]
    elev, elev_src = fetch_elevations(latlon[:, 0], latlon[:, 1],
                                      f"{cfg['name']}_{lat0:.4f}_{lon0:.4f}_{cfg['dist_m']}",
                                      offline=offline)
    nodes = pd.DataFrame({"x": xy[:, 0], "y": xy[:, 1], "lat": latlon[:, 0],
                          "lon": latlon[:, 1], "elevation": elev},
                         index=[names[n] for n in node_ids])

    # ---- unique street segments -> pipes
    seen: set[tuple] = set()
    rows = []
    for u, v, data in ug.edges(data=True):
        if u == v:
            continue
        key = tuple(sorted((u, v)))
        if key in seen:
            continue
        seen.add(key)
        rows.append({"start": names[u], "end": names[v],
                     "length": max(float(data.get("length", 10.0)), 5.0),
                     "street": str(data.get("name", "")) if data.get("name") else ""})
    pipes = pd.DataFrame(rows)
    pipes.index = [f"P{i}" for i in range(len(pipes))]

    # street length served by each node -> population share
    served = pd.Series(0.0, index=nodes.index)
    for _, p in pipes.iterrows():
        served[p.start] += p.length / 2
        served[p.end] += p.length / 2
    nodes["population"] = cfg["population"] * served / served.sum()

    # ---- synthetic attributes (seeded): an older core, sewer alongside some streets
    core = nodes[["x", "y"]].sample(1, random_state=int(rng.integers(1e9))).to_numpy()[0]
    mid = (nodes.loc[pipes.start, ["x", "y"]].to_numpy() +
           nodes.loc[pipes.end, ["x", "y"]].to_numpy()) / 2
    d_core = np.linalg.norm(mid - core, axis=1)
    d_core = d_core / d_core.max()
    pipes["age_years"] = np.clip(45 - 35 * d_core + rng.normal(0, 6, len(pipes)), 3, 60).round()
    pipes["material"] = np.where(pipes["age_years"] > 25, "CI", "DI")
    pipes["roughness"] = np.clip(140 - 1.2 * pipes["age_years"], 70, 140)
    pipes["sewer_alongside"] = rng.random(len(pipes)) < cfg.get("sewer_share", 0.6)
    pipes["mid_x"], pipes["mid_y"] = mid[:, 0], mid[:, 1]

    # ---- diameters from a shortest-path tree rooted at the source
    src = _pick_source(nodes, cfg.get("source_corner", "north_west"))
    sg = nx.Graph()
    for pname, p in pipes.iterrows():
        sg.add_edge(p.start, p.end, weight=p.length, pipe=pname)
    tree = nx.shortest_path(sg, src, weight="weight")
    load = pd.Series(0.0, index=pipes.index)
    for target, path in tree.items():
        for a, b in zip(path[:-1], path[1:]):
            load[sg[a][b]["pipe"]] += nodes.loc[target, "population"]
    share = load / nodes["population"].sum()
    pipes["diameter_mm"] = np.select(
        [share > 0.5, share > 0.2, share > 0.06, share > 0.0],
        [250, 200, 150, 100], default=100)

    # ---- WNTR model
    wn = wntr.network.WaterNetworkModel()
    hyd = cfg["hydraulics"]
    sup = cfg["supply"]
    wn.options.time.duration = hyd["duration_h"] * 3600
    wn.options.time.hydraulic_timestep = hyd["hydraulic_step_s"]
    wn.options.time.quality_timestep = hyd["quality_step_s"]
    wn.options.time.report_timestep = hyd["hydraulic_step_s"]
    wn.options.time.pattern_timestep = 3600
    wn.options.hydraulic.demand_model = "PDD"
    wn.options.hydraulic.required_pressure = sup["required_pressure_m"]
    wn.options.hydraulic.minimum_pressure = sup["minimum_pressure_m"]

    on_hours = supply_on_mask(sup["windows"])
    n_on = on_hours.sum()
    # households fill storage during supply: the full daily volume arrives in the windows
    demand_mult = np.where(on_hours, 24.0 / n_on, 0.02)
    wn.add_pattern("supply_demand", list(demand_mult))
    max_elev = float(nodes["elevation"].max())
    base_head = max_elev + sup["head_on_m"]
    off_mult = (max_elev + sup["head_off_m"]) / base_head
    wn.add_pattern("tank_head", list(np.where(on_hours, 1.0, off_mult)))

    for name, n in nodes.iterrows():
        q = n.population * cfg["lpcd"] / 1000 / 86400  # m3/s average
        wn.add_junction(name, base_demand=q, demand_pattern="supply_demand",
                        elevation=float(n.elevation), coordinates=(n.x, n.y))
    sx, sy = nodes.loc[src, ["x", "y"]]
    wn.add_reservoir("TANK", base_head=base_head, head_pattern="tank_head",
                     coordinates=(sx - 40, sy + 40))
    wn.add_pipe("P_SUPPLY", "TANK", src, length=60, diameter=0.3, roughness=130)
    for pname, p in pipes.iterrows():
        wn.add_pipe(pname, p.start, p.end, length=p.length,
                    diameter=p.diameter_mm / 1000, roughness=p.roughness)

    provenance = {
        "streets": "OpenStreetMap (real)",
        "elevation": elev_src,
        "pipes": "synthetic, constrained to OSM streets (seeded)",
        "sewers": "synthetic, constrained to OSM streets (seeded)",
        "source_node": src,
    }
    return WardNetwork(wn=wn, nodes=nodes, pipes=pipes, cfg=cfg, provenance=provenance)


def supply_on_mask(windows: list[list[int]]) -> np.ndarray:
    mask = np.zeros(24, dtype=bool)
    for a, b in windows:
        mask[a:b] = True
    return mask


def node_sewer_share(ward: WardNetwork) -> pd.Series:
    """Share of a junction's connected street length that has a sewer alongside."""
    tot = pd.Series(0.0, index=ward.nodes.index)
    sew = pd.Series(0.0, index=ward.nodes.index)
    for _, p in ward.pipes.iterrows():
        for n in (p.start, p.end):
            tot[n] += p.length
            sew[n] += p.length * p.sewer_alongside
    return (sew / tot.replace(0, np.nan)).fillna(0.0)


def node_mean_age(ward: WardNetwork) -> pd.Series:
    tot = pd.Series(0.0, index=ward.nodes.index)
    acc = pd.Series(0.0, index=ward.nodes.index)
    for _, p in ward.pipes.iterrows():
        for n in (p.start, p.end):
            tot[n] += p.length
            acc[n] += p.length * p.age_years
    return acc / tot.replace(0, np.nan)


def load_benchmark(name: str = "Net3") -> wntr.network.WaterNetworkModel:
    """Load a bundled benchmark network (24x7 supply) for engine robustness checks."""
    import glob

    base = os.path.dirname(wntr.__file__)
    hits = glob.glob(os.path.join(base, "**", f"{name}.inp"), recursive=True)
    if not hits:
        raise FileNotFoundError(name)
    return wntr.network.WaterNetworkModel(hits[0])
