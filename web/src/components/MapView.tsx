import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { AmbientLight, DirectionalLight, FlyToInterpolator, LightingEffect, type MapViewState } from "@deck.gl/core";
import { ColumnLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { CollisionFilterExtension } from "@deck.gl/extensions";

const collide = new CollisionFilterExtension();
import { useStore } from "../store";

type RGBA = [number, number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function heat(t: number, alpha = 255): RGBA {
  // cyan -> amber -> coral
  const c1 = [103, 232, 249], c2 = [245, 181, 68], c3 = [255, 92, 92];
  const [a, b, u] = t < 0.5 ? [c1, c2, t / 0.5] : [c2, c3, (t - 0.5) / 0.5];
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u), alpha];
}
function hash(i: number) { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }

const lighting = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.1 }),
  sun: new DirectionalLight({ color: [180, 220, 255], intensity: 1.6, direction: [-3, -9, -4] }),
});

export default function MapView() {
  const { net, state, layers, view, focus } = useStore();
  const [t, setT] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const loop = () => { setT((performance.now() - t0) / 1000); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const center = net?.center ?? [75.847, 22.7637];
  const [viewState, setViewState] = useState<MapViewState>({
    longitude: center[0], latitude: center[1], zoom: 13.6, pitch: 0, bearing: 0,
  });
  useEffect(() => {
    if (!net) return;
    const delay = view === "intro" ? 0 : 60;
    const id = window.setTimeout(() => {
    if (view === "intro") {
      setViewState({ longitude: net.center[0], latitude: net.center[1], zoom: 14.4, pitch: 20, bearing: 30 });
    } else {
      setViewState((v) => ({ ...v, longitude: net.center[0] + 0.0012, latitude: net.center[1] - 0.0012,
        zoom: 16.45, pitch: 54, bearing: -22, transitionDuration: 3200, transitionInterpolator: new FlyToInterpolator({ speed: 1.1 }) }));
    }
    }, delay);
    return () => window.clearTimeout(id);
  }, [net, view === "intro"]);
  useEffect(() => {
    if (!focus) return;
    setViewState((v) => ({ ...v, longitude: focus.lon, latitude: focus.lat - 0.0009, zoom: 17, pitch: 58,
      transitionDuration: 1800, transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }) }));
  }, [focus?.at]);

  const alerting = state?.status === "ALERT";
  const pmax = useMemo(() => (state ? Math.max(...state.p_location, 1e-9) : 1), [state]);

  const deckLayers = useMemo(() => {
    if (!net) return [];
    const nodes = net.nodes;
    const P = state?.p_location ?? nodes.map(() => 0);
    const out: any[] = [];

    if (layers.buildings && net.buildings.length) {
      out.push(new PolygonLayer({
        id: "buildings", data: net.buildings, extruded: true, wireframe: false, opacity: 0.55,
        getPolygon: (d: any) => d.c,
        getElevation: (d: any, { index }: any) => (d.l ? d.l * 3.2 : 4 + hash(index) * 9),
        getFillColor: [26, 46, 70, 255], material: { ambient: 0.5, diffuse: 0.6, shininess: 20 },
      }));
    }

    // pipes: wide glow + core, coloured by posterior heat when alerting
    const pipeColor = (d: any, alpha: number): RGBA => {
      if (!alerting) return [52, 120, 180, alpha];
      const h = Math.min(1, ((P[d.a] + P[d.b]) / 2 / pmax) ** 0.6);
      return h < 0.04 ? [52, 120, 180, alpha] : heat(h, alpha);
    };
    out.push(new PathLayer({
      id: "pipes-glow", data: net.pipes, widthUnits: "meters", widthMinPixels: 3,
      getPath: (d: any) => [[nodes[d.a].lon, nodes[d.a].lat], [nodes[d.a].lon, nodes[d.a].lat], [nodes[d.b].lon, nodes[d.b].lat]],
      getWidth: (d: any) => d.diameter_mm / 18 + 3, getColor: (d: any) => pipeColor(d, 50), capRounded: true,
      updateTriggers: { getColor: [state?.day, state?.extras, alerting] },
    }));
    out.push(new PathLayer({
      id: "pipes", data: net.pipes, widthUnits: "meters", widthMinPixels: 1.4,
      getPath: (d: any) => [[nodes[d.a].lon, nodes[d.a].lat], [nodes[d.b].lon, nodes[d.b].lat]],
      getWidth: (d: any) => d.diameter_mm / 60, getColor: (d: any) => pipeColor(d, 235), capRounded: true,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120],
      updateTriggers: { getColor: [state?.day, state?.extras, alerting] },
    }));

    if (layers.flow) {
      out.push(new TripsLayer({
        id: "flow", data: net.trips, getPath: (d: any) => d.p, getTimestamps: (d: any) => d.t,
        getColor: [125, 235, 255], opacity: 0.85, widthMinPixels: 2.2, jointRounded: true, capRounded: true,
        trailLength: 520, currentTime: (t * 380) % net.trip_loop_s, fadeTrail: true,
      }));
    }

    // contamination plume: spreads from the most likely segment in EPANET arrival order
    if (layers.plume && alerting && state) {
      const arr = state.plume.arrival_h, reach = state.plume.reach;
      const valid = arr.filter((a) => a >= 0);
      const lo = Math.min(...valid), hi = Math.max(...valid, lo + 0.5);
      const phase = (t % 5.5) / 4.2;
      const lit = nodes.filter((n) => arr[n.i] >= 0 && reach[n.i] > 0.03 && (arr[n.i] - lo) / (hi - lo) <= phase);
      out.push(new ScatterplotLayer({
        id: "plume", data: lit, getPosition: (n: any) => [n.lon, n.lat],
        getRadius: (n: any) => 8 + 30 * Math.sqrt(reach[n.i]), radiusUnits: "meters",
        getFillColor: (n: any) => [255, 107, 107, 40 + 90 * reach[n.i]], stroked: false,
      }));
      const litSet = new Set(lit.map((n) => n.i));
      out.push(new PathLayer({
        id: "plume-pipes", data: net.pipes.filter((p) => litSet.has(p.a) && litSet.has(p.b)),
        getPath: (d: any) => [[nodes[d.a].lon, nodes[d.a].lat], [nodes[d.b].lon, nodes[d.b].lat]],
        widthUnits: "meters", getWidth: 5, widthMinPixels: 2.5, getColor: [255, 107, 107, 170], capRounded: true,
      }));
    }

    // probability columns
    if (layers.columns && alerting && state) {
      const top = state.top.slice(0, 5);
      out.push(new ColumnLayer({
        id: "cols", data: top, diskResolution: 24, radius: 7, extruded: true, radiusUnits: "meters",
        getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        getElevation: (d: any) => 20 + 150 * (d.p / pmax), elevationScale: 1,
        getFillColor: (d: any) => heat(Math.min(1, 0.45 + 0.55 * (d.p / pmax)), 235),
        material: { ambient: 0.6, diffuse: 0.7, shininess: 40 },
        transitions: { getElevation: { duration: 900, easing: (x: number) => 1 - (1 - x) ** 3 } },
        pickable: true,
      }));
    }

    // junction dots sized by probability
    out.push(new ScatterplotLayer({
      id: "nodes", data: nodes, getPosition: (n: any) => [n.lon, n.lat], radiusUnits: "meters",
      getRadius: (n: any) => (alerting ? 2.5 + 16 * Math.sqrt(P[n.i] / pmax) : 2.4),
      getFillColor: (n: any) => (alerting ? heat(Math.min(1, (P[n.i] / pmax) ** 0.6), 210) : [120, 200, 255, 180]),
      pickable: true, updateTriggers: { getRadius: [state?.day, state?.extras], getFillColor: [state?.day, state?.extras] },
      transitions: { getRadius: 600 },
    }));

    // complaints (last 3 days) with ripples
    if (state) {
      const recent = state.complaints.filter((c) => c.day >= state.day - 2);
      const byNode = new Map<number, number>();
      recent.forEach((c) => byNode.set(c.node, (byNode.get(c.node) ?? 0) + c.count));
      const pts = [...byNode.entries()].map(([node, count]) => ({ node, count }));
      const ph = (t % 2) / 2;
      out.push(new ScatterplotLayer({
        id: "complaint-ripple", data: pts, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        radiusUnits: "meters", getRadius: (d: any) => 6 + ph * (22 + 6 * d.count), filled: false, stroked: true,
        getLineColor: [255, 170, 60, Math.round(220 * (1 - ph))], lineWidthMinPixels: 1.5,
      }));
      out.push(new ScatterplotLayer({
        id: "complaints", data: pts, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        radiusUnits: "meters", getRadius: (d: any) => 4 + 2 * d.count, getFillColor: [255, 170, 60, 235], pickable: true,
      }));
      const tests = state.tests.filter((x) => x.day >= state.day - 3);
      out.push(new ScatterplotLayer({
        id: "tests", data: tests, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        radiusUnits: "meters", getRadius: 5.5, getFillColor: (d: any) => (d.failed ? [255, 84, 84, 255] : [52, 211, 153, 255]),
        stroked: true, getLineColor: [3, 11, 20, 255], lineWidthMinPixels: 1.5, pickable: true,
      }));
      const ps = 0.5 + 0.5 * Math.sin(t * 3.2);
      out.push(new ScatterplotLayer({
        id: "suggest", data: state.suggested, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        radiusUnits: "meters", getRadius: 12 + 6 * ps, filled: false, stroked: true,
        getLineColor: [96, 165, 250, 230], lineWidthMinPixels: 2.5, pickable: true,
      }));
      if (alerting) {
        out.push(new TextLayer({
          id: "ranks", data: state.top.slice(0, 1).map((d, k) => ({ ...d, k })),
          getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat, 32 + 150 * (d.p / pmax)],
          getText: (d: any) => `#1 most likely · ${(100 * d.p).toFixed(0)}%`, getSize: 14, getColor: [255, 255, 255, 255], fontWeight: 700,
          fontFamily: "Space Grotesk Variable, sans-serif", background: true, getBackgroundColor: [12, 24, 40, 230],
          backgroundPadding: [6, 3], getBorderColor: [255, 107, 107, 255], getBorderWidth: 1.5,
          getPixelOffset: [0, -12], billboard: true,
        }));
      }
    }

    // landmarks: pharmacies + overhead tank
    out.push(new ScatterplotLayer({
      id: "pois", data: net.pois.filter((p) => p.pharmacy), getPosition: (d: any) => [d.lon, d.lat],
      radiusUnits: "meters", getRadius: 4, getFillColor: [167, 139, 250, 255], pickable: true,
    }));
    out.push(new TextLayer({
      id: "poi-text", data: net.pois.filter((p) => p.pharmacy || p.kind === "school"),
      getPosition: (d: any) => [d.lon, d.lat], getText: (d: any) => d.name, getSize: 11,
      getColor: [196, 181, 253, 210], getPixelOffset: [0, -14], fontFamily: "Inter Variable, sans-serif",
      extensions: [collide], collisionGroup: "labels", getCollisionPriority: (d: any) => (d.pharmacy ? 1 : 0),
    }));
    const src = nodes[net.source];
    out.push(new ColumnLayer({
      id: "tank", data: [src], diskResolution: 6, radius: 9, extruded: true, radiusUnits: "meters",
      getPosition: (n: any) => [n.lon, n.lat], getElevation: 34, getFillColor: [103, 232, 249, 230],
      material: { ambient: 0.7, diffuse: 0.6 },
    }));
    out.push(new TextLayer({
      id: "tank-text", data: [src], getPosition: (n: any) => [n.lon, n.lat, 40], getText: () => "Overhead tank",
      getSize: 12, getColor: [165, 243, 252, 255], fontFamily: "Inter Variable, sans-serif",
    }));

    // focus ripple from intake (new complaint / field test)
    if (focus && Date.now() - focus.at < 6000) {
      const ph = ((Date.now() - focus.at) % 1500) / 1500;
      const col: RGBA = focus.kind === "test" ? [96, 165, 250, 255] : [255, 170, 60, 255];
      out.push(new ScatterplotLayer({
        id: "focus", data: [0, 1, 2], getPosition: () => [focus.lon, focus.lat], radiusUnits: "meters",
        getRadius: (k: any) => 8 + ((ph + k / 3) % 1) * 70, filled: false, stroked: true,
        getLineColor: (k: any) => [col[0], col[1], col[2], Math.round(255 * (1 - ((ph + k / 3) % 1)))], lineWidthMinPixels: 2,
        updateTriggers: { getRadius: t, getLineColor: t },
      }));
    }
    return out;
  }, [net, state, layers, t, alerting, pmax, focus]);

  const tooltip = ({ object, layer }: any) => {
    if (!object || !net) return null;
    const style = { background: "rgba(6,20,34,.94)", border: "1px solid rgba(120,190,255,.2)", borderRadius: "10px",
      color: "#e6f1fb", fontFamily: "Inter Variable, sans-serif", fontSize: "12px", padding: "8px 10px" };
    const P = state?.p_location;
    if (layer.id === "nodes") {
      const n = object;
      return { html: `<b>${n.label}</b><br/>P(ingress here | event) ${P ? (100 * P[n.i]).toFixed(1) : "0"}%<br/>pipe age ~${n.age?.toFixed(0) ?? "?"} y · sewer alongside ${(100 * n.sewer).toFixed(0)}%<br/>residual Cl (model) ${n.cl.toFixed(2)} mg/L`, style };
    }
    if (layer.id === "pipes") return { html: `<b>Pipe ${object.id}</b> · ${object.diameter_mm} mm · ${object.age} y<br/>flow ${object.flow_lps.toFixed(2)} L/s · sewer alongside: ${object.sewer ? "yes" : "no"}<br/><i>synthetic pipe on real street</i>`, style };
    if (layer.id === "complaints") return { html: `<b>${object.count} complaint(s)</b> in the last 3 days<br/>${net.nodes[object.node].label}`, style };
    if (layer.id === "tests") return { html: `<b>Field test, day ${object.day}</b><br/>${object.failed ? "FAILED: below 0.2 mg/L" : "passed"}`, style };
    if (layer.id === "suggest") return { html: `<b>Suggested next test</b><br/>${object.label}`, style };
    if (layer.id === "cols") return { html: `<b>${object.label}</b><br/>${(100 * object.p).toFixed(0)}% of the event probability`, style };
    if (layer.id === "pois") return { html: `<b>${object.name}</b><br/>partner pharmacy (aggregate ORS counts)`, style };
    return null;
  };

  return (
    <div className="absolute inset-0" style={{ background: "radial-gradient(1200px 800px at 55% 45%, #0b2236 0%, #050f1a 55%, #02070d 100%)" }}>
      <DeckGL
        initialViewState={viewState}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={deckLayers}
        effects={[lighting]}
        getTooltip={tooltip}
        useDevicePixels={true}
      />
    </div>
  );
}
