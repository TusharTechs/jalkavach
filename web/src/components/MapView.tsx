import { useEffect, useMemo, useRef, useState } from "react";
import { HUD_MIN_H, HUD_MIN_W } from "../fit";
import DeckGL from "@deck.gl/react";
import { AmbientLight, DirectionalLight, FlyToInterpolator, LightingEffect, WebMercatorViewport, type MapViewState } from "@deck.gl/core";
import { ColumnLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { motion, useReducedMotion } from "motion/react";
import { useStore } from "../store";
import { useL, useT } from "../i18n";

const SHOT = new URLSearchParams(window.location.search).has("shot");

type RGBA = [number, number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function heat(t: number, alpha = 255): RGBA {
  // cyan -> amber -> coral
  const c1 = [103, 232, 249], c2 = [245, 181, 68], c3 = [255, 92, 92];
  const [a, b, u] = t < 0.5 ? [c1, c2, t / 0.5] : [c2, c3, (t - 0.5) / 0.5];
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u), alpha];
}
function hash(i: number) { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }
const colH = (p: number) => 12 + 600 * p;          // probability column height (absolute)

const lighting = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.1 }),
  sun: new DirectionalLight({ color: [180, 220, 255], intensity: 1.6, direction: [-3, -9, -4] }),
});

export default function MapView() {
  const { net, state, layers, view, focus, stage, lang, toggleLayer, notify } = useStore();
  const t_ = useT();
  const L = useL();
  const still = useReducedMotion();
  // animation clock at ≤30 fps; static layers are memoised separately so only the animated ones rebuild
  const [t, setT] = useState(0);
  const [, bump] = useState(0);
  const panels = useRef<DOMRect[]>([]);
  useEffect(() => {
    // the map only re-renders while animating, so re-render when panels move (static night hours too)
    let sig = "";
    const read = () => {
      panels.current = [...document.querySelectorAll(".glass")].filter((e) => !e.closest("[data-map-overlay]")).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.width < window.innerWidth * 0.9);
      const n = panels.current.map((r) => `${r.left | 0},${r.top | 0},${r.right | 0},${r.bottom | 0}`).join(";");
      if (n !== sig) { sig = n; bump((x) => x + 1); }
    };
    read();
    const id = window.setInterval(read, 300);
    return () => window.clearInterval(id);
  }, []);          // re-project HTML overlays on camera moves when animation is off
  const fps = useRef({ frames: 0, since: performance.now(), dropped: false });
  useEffect(() => {
    if (still) return;
    let raf = 0, last = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const f = fps.current;
      f.frames++;
      if (now - f.since > 3000) {
        const rate = (1000 * f.frames) / (now - f.since);
        if (rate < 32 && !f.dropped && !document.hidden && !SHOT && useStore.getState().layers.buildings) {
          f.dropped = true; toggleLayer("buildings"); notify("Low frame rate: 3D buildings turned off", "info");
        }
        f.frames = 0; f.since = now;
      }
      if (now - last < 33) return;
      last = now;
      setT((now - t0) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [still]);

  const center = net?.center ?? [75.847, 22.7637];
  const far = view === "intro" || view === "prologue";
  const drawer = !far && view !== "command";
  const target = (isFar: boolean, isDrawer: boolean): MapViewState => isFar
    ? { longitude: center[0], latitude: center[1], zoom: 14.4, pitch: 20, bearing: 30 }
    : { longitude: center[0] + (isDrawer ? 0.0042 : 0.0010), latitude: center[1] - 0.0012, zoom: stage ? 16.6 : 16.2, pitch: stage ? 56 : 54, bearing: -22 };
  const [viewState, setViewState] = useState<MapViewState>(() => target(far, drawer));
  const live = useRef<MapViewState>(viewState);
  const first = useRef(true);
  const fly = (v: MapViewState, ms: number, speed = 1.2) =>
    setViewState({ ...v, transitionDuration: still ? 0 : ms, transitionInterpolator: new FlyToInterpolator({ speed }) });
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    fly(target(far, drawer), far ? 0 : 2600);
  }, [far, drawer, stage]);
  useEffect(() => {
    if (!focus) return;
    fly({ ...live.current, longitude: focus.lon + (drawer ? 0.003 : 0), latitude: focus.lat - 0.0009, zoom: stage ? 17.2 : 16.9, pitch: 56 }, 1800, 1.4);
  }, [focus?.at]);

  const alerting = state?.status === "ALERT";
  const pmax = useMemo(() => (state ? Math.max(...state.p_location, 1e-9) : 1), [state]);

  const staticLayers = useMemo(() => {
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
    const pipeColor = (d: any, alpha: number): RGBA => {
      if (!alerting) return [52, 120, 180, alpha];
      const h = Math.min(1, ((P[d.a] + P[d.b]) / 2 / pmax) ** 0.6);
      return h < 0.04 ? [52, 120, 180, alpha] : heat(h, alpha);
    };
    out.push(new PathLayer({
      id: "pipes-glow", data: net.pipes, widthUnits: "meters", widthMinPixels: 3,
      getPath: (d: any) => [[nodes[d.a].lon, nodes[d.a].lat], [nodes[d.b].lon, nodes[d.b].lat]],
      getWidth: (d: any) => d.diameter_mm / 18 + 3, getColor: (d: any) => pipeColor(d, 50), capRounded: true,
      updateTriggers: { getColor: [state?.p_location, alerting] },
    }));
    out.push(new PathLayer({
      id: "pipes", data: net.pipes, widthUnits: "meters", widthMinPixels: 1.4,
      getPath: (d: any) => [[nodes[d.a].lon, nodes[d.a].lat], [nodes[d.b].lon, nodes[d.b].lat]],
      getWidth: (d: any) => d.diameter_mm / 60, getColor: (d: any) => pipeColor(d, 235), capRounded: true,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120],
      updateTriggers: { getColor: [state?.p_location, alerting] },
    }));
    if (layers.columns && alerting && state) {
      out.push(new ColumnLayer({
        id: "cols", data: state.top.slice(0, 5), diskResolution: 24, radius: 7, extruded: true, radiusUnits: "meters",
        getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        getElevation: (d: any) => colH(d.p), elevationScale: 1,
        getFillColor: (d: any) => heat(Math.min(1, 0.45 + 0.55 * (d.p / pmax)), 235),
        material: { ambient: 0.6, diffuse: 0.7, shininess: 40 },
        transitions: { getElevation: { duration: still ? 0 : 900, easing: (x: number) => 1 - (1 - x) ** 3 } },
        pickable: true,
      }));
    }
    out.push(new ScatterplotLayer({
      id: "nodes", data: nodes, getPosition: (n: any) => [n.lon, n.lat], radiusUnits: "meters",
      getRadius: (n: any) => (alerting ? 2.5 + 16 * Math.sqrt(P[n.i] / pmax) : 2.4),
      getFillColor: (n: any) => (alerting ? heat(Math.min(1, (P[n.i] / pmax) ** 0.6), 210) : [120, 200, 255, 180]),
      pickable: true, updateTriggers: { getRadius: [state?.p_location, alerting], getFillColor: [state?.p_location, alerting] },
      transitions: { getRadius: still ? 0 : 600 },
    }));
    if (state) {
      const tests = state.tests.filter((x) => x.day >= state.day - 3);
      out.push(new ScatterplotLayer({
        id: "tests", data: tests.filter((x) => !x.failed), getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        radiusUnits: "meters", getRadius: 5.5, getFillColor: [52, 211, 153, 255],
        stroked: true, getLineColor: [3, 11, 20, 255], lineWidthMinPixels: 1.5, pickable: true,
      }));
      out.push(new TextLayer({
        id: "tests-failed", data: tests.filter((x) => x.failed), getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
        getText: () => "✕", getSize: 20, getColor: [255, 84, 84, 255], fontWeight: 900, pickable: true, characterSet: ["✕"],
        fontFamily: "Inter Variable, sans-serif", outlineWidth: 3, outlineColor: [3, 11, 20, 255], fontSettings: { sdf: true },
      }));
    }
    out.push(new ScatterplotLayer({
      id: "pois", data: net.pois.filter((p) => p.pharmacy), getPosition: (d: any) => [d.lon, d.lat],
      radiusUnits: "meters", getRadius: 4, getFillColor: [167, 139, 250, 255], pickable: true,
    }));
    const src = nodes[net.source];
    out.push(new ColumnLayer({
      id: "tank", data: [src], diskResolution: 6, radius: 9, extruded: true, radiusUnits: "meters",
      getPosition: (n: any) => [n.lon, n.lat], getElevation: 34, getFillColor: [103, 232, 249, 230],
      material: { ambient: 0.7, diffuse: 0.6 },
    }));
    return out;
  }, [net, state, layers, alerting, pmax, lang, still]);

  const animLayers = useMemo(() => {
    if (!net || !state) return [];
    const nodes = net.nodes;
    const out: any[] = [];
    if (layers.flow && !state.supply_on) {
      const dmax = Math.max(...nodes.map((n) => n.deficit), 1e-6);
      const ph2 = still ? 1 : 0.75 + 0.25 * Math.sin(t * 2);
      out.push(new ScatterplotLayer({
        id: "lowpressure", data: nodes, getPosition: (n: any) => [n.lon, n.lat], radiusUnits: "meters", pickable: true,
        getRadius: (n: any) => 4 + 16 * (n.deficit / dmax) * ph2, getFillColor: (n: any) => [124, 111, 168, 25 + 95 * (n.deficit / dmax)],
        stroked: false, updateTriggers: { getRadius: t },
      }));
    }
    if (layers.flow && state.supply_on) {
      out.push(new TripsLayer({
        id: "flow", data: net.trips, getPath: (d: any) => d.p, getTimestamps: (d: any) => d.t,
        getColor: [125, 235, 255], opacity: 0.85, widthMinPixels: 2.2, jointRounded: true, capRounded: true,
        trailLength: 520, currentTime: still ? net.trip_loop_s / 2 : (t * 380) % net.trip_loop_s, fadeTrail: true,
      }));
    }
    if (layers.plume && alerting) {
      const arr = state.plume.arrival_h, reach = state.plume.reach;
      const valid = arr.filter((a) => a >= 0);
      const lo = Math.min(...valid), hi = Math.max(...valid, lo + 0.5);
      const phase = still ? 1 : (t % 5.5) / 4.2;
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
    const recent = state.complaints.filter((c) => c.day >= state.day - 2);
    const byNode = new Map<number, number>();
    recent.forEach((c) => byNode.set(c.node, (byNode.get(c.node) ?? 0) + c.count));
    const pts = [...byNode.entries()].map(([node, count]) => ({ node, count }));
    const ph = still ? 0.4 : (t % 2) / 2;
    out.push(new ScatterplotLayer({
      id: "complaint-ripple", data: pts, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
      radiusUnits: "meters", getRadius: (d: any) => 6 + ph * (22 + 6 * d.count), filled: false, stroked: true,
      getLineColor: [255, 170, 60, Math.round(220 * (1 - ph))], lineWidthMinPixels: 1.5,
    }));
    out.push(new ScatterplotLayer({
      id: "complaints", data: pts, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
      radiusUnits: "meters", getRadius: (d: any) => 4 + 2 * d.count, getFillColor: [255, 170, 60, 235], pickable: true,
    }));
    const ps = still ? 0.5 : 0.5 + 0.5 * Math.sin(t * 3.2);
    out.push(new ScatterplotLayer({
      id: "suggest", data: state.suggested, getPosition: (d: any) => [nodes[d.node].lon, nodes[d.node].lat],
      radiusUnits: "meters", getRadius: 12 + 6 * ps, filled: false, stroked: true,
      getLineColor: [96, 165, 250, 230], lineWidthMinPixels: 2.5, pickable: true,
    }));
    if (focus && Date.now() - focus.at < 6000) {
      const fph = ((Date.now() - focus.at) % 1500) / 1500;
      const col: RGBA = focus.kind === "test" ? [96, 165, 250, 255] : focus.kind === "alert" ? [255, 107, 107, 255] : [255, 170, 60, 255];
      out.push(new ScatterplotLayer({
        id: "focus", data: [0, 1, 2], getPosition: () => [focus.lon, focus.lat], radiusUnits: "meters",
        getRadius: (k: any) => 8 + ((fph + k / 3) % 1) * 70, filled: false, stroked: true,
        getLineColor: (k: any) => [col[0], col[1], col[2], Math.round(255 * (1 - ((fph + k / 3) % 1)))], lineWidthMinPixels: 2,
        updateTriggers: { getRadius: t, getLineColor: t },
      }));
    }
    return out;
  }, [net, state, layers, t, alerting, focus, still]);

  // HTML overlays projected from the live camera: the #1 callout and landmark labels.
  // (HTML, not a deck TextLayer, so Devanagari is shaped correctly.)
  const vp = new WebMercatorViewport({ ...live.current, width: window.innerWidth, height: window.innerHeight });
  const onScreen = (x: number, y: number) => x > 0 && y > 0 && x < window.innerWidth && y < window.innerHeight;
  // HUD panels are translucent: never draw a map label (or the callout) underneath one
  const underPanel = (x: number, y: number, w: number, h: number) =>
    panels.current.some((r) => x + w / 2 > r.left && x - w / 2 < r.right && y > r.top && y - h < r.bottom);
  const top1 = alerting && state ? state.top[0] : null;
  let callout: { x: number; y: number } | null = null;
  if (top1 && net && view === "command" && layers.columns) {
    const n = net.nodes[top1.node];
    const [x, y] = vp.project([n.lon, n.lat, colH(top1.p)]);
    if (onScreen(x, y) && !underPanel(x, y - 10, 200, 52)) callout = { x, y };
  }
  const labels: { x: number; y: number; text: string; kind: "poi" | "store" | "tank" }[] = [];
  if (net && !far) {
    const src = net.nodes[net.source];
    const cands = [
      { lon: src.lon, lat: src.lat, z: 40, text: lang === "hi" ? "सप्लाई टंकी" : "Supply tank", kind: "tank" as const },
      // the OSM "water tank" landmark is the supply tank itself: label it once
      ...[...net.pois].filter((p) => Math.hypot(p.lat - src.lat, (p.lon - src.lon) * 0.92) > 0.0008).sort((a, b) => Number(b.pharmacy) - Number(a.pharmacy))
        .map((p) => ({ lon: p.lon, lat: p.lat, z: 0, text: lang === "hi" ? p.name_hi : p.name, kind: (p.pharmacy ? "store" : "poi") as "store" | "poi" })),
    ];
    for (const c of cands) {
      const [x, y] = vp.project([c.lon, c.lat, c.z]);
      if (!onScreen(x, y) || underPanel(x, y - 8, c.text.length * 7 + 8, 20) || labels.some((l) => Math.abs(l.x - x) < 70 && Math.abs(l.y - y) < 18)) continue;
      labels.push({ x, y, text: c.text, kind: c.kind });
    }
  }

  const tooltip = ({ object, layer }: any) => {
    if (!object || !net) return null;
    const style = { background: "rgba(6,20,34,.94)", border: "1px solid rgba(120,190,255,.2)", borderRadius: "10px",
      color: "#e6f1fb", fontFamily: "Inter Variable, Noto Sans Devanagari, sans-serif", fontSize: "12.5px", padding: "8px 10px" };
    const P = state?.p_location;
    const lab = (i: number) => L(net.nodes[i]);
    if (layer.id === "nodes") {
      const n = object;
      return { html: `<b>${L(n)}</b><br/>P(ingress here | event) ${P ? (100 * P[n.i]).toFixed(1) : "0"}%<br/>pipe age ~${n.age?.toFixed(0) ?? "?"} y · sewer alongside ${(100 * n.sewer).toFixed(0)}%<br/>≈${n.pop} residents served · residual Cl (model) ${n.cl.toFixed(2)} mg/L`, style };
    }
    if (layer.id === "pipes") return { html: `<b>Pipe ${object.id}</b> · ${object.diameter_mm} mm · ${object.age} y<br/>flow ${object.flow_lps.toFixed(2)} L/s · sewer alongside: ${object.sewer ? "yes" : "no"}<br/><i>synthetic pipe on a real street</i>`, style };
    if (layer.id === "complaints") return { html: `<b>${object.count} complaint(s)</b> in the last 3 days<br/>${lab(object.node)}`, style };
    if (layer.id === "tests" || layer.id === "tests-failed") return { html: `<b>Field test, day ${object.day}</b><br/>${object.failed ? "✕ FAILED: below 0.2 mg/L" : "passed"}<br/>${lab(object.node)}`, style };
    if (layer.id === "suggest") return { html: `<b>Suggested next test</b><br/>${L(object)}`, style };
    if (layer.id === "cols") return { html: `<b>${L(object)}</b><br/>${lang === "hi" ? `घटना की संभावना का ${(100 * object.p).toFixed(0)}% · अपुष्ट` : `${(100 * object.p).toFixed(0)}% of the event probability · unconfirmed`}`, style };
    if (layer.id === "pois") return { html: `<b>${lang === "hi" ? object.name_hi : object.name}</b><br/>${lang === "hi" ? "उदाहरण हेतु साझेदार स्टोर · सिमुलेटेड आँकड़े" : "illustrative partner store · simulated counts"}`, style };
    if (layer.id === "lowpressure") return { html: `<b>${L(object)}</b><br/>low-pressure exposure (supply off): ${object.deficit.toFixed(1)} pressure-deficit hours/day`, style };
    return null;
  };

  return (
    <div className="absolute inset-0" style={{ background: "radial-gradient(1200px 800px at 55% 45%, #0b2236 0%, #050f1a 55%, #02070d 100%)" }}>
      <DeckGL
        initialViewState={viewState}
        onViewStateChange={({ viewState: v }: any) => { live.current = v; if (still) bump((x) => x + 1); }}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={[...staticLayers, ...animLayers]}
        effects={[lighting]}
        getTooltip={tooltip}
        useDevicePixels={1.5}
      />
      {/* hard clip under the top bar (124 px on the HUD canvas), independent of the panel read-back timing */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden
        style={{ clipPath: `inset(${Math.ceil(124 * Math.min(1, window.innerWidth / HUD_MIN_W, window.innerHeight / HUD_MIN_H))}px 0 0 0)` }}>
        {labels.map((l, i) => (
          <div key={i} className={l.kind === "tank" ? "absolute text-[12.5px] font-semibold text-[#A5F3FC] whitespace-nowrap" : "absolute text-[11.5px] text-[#C4B5FD]/90 whitespace-nowrap"}
            style={{ left: l.x, top: l.y, transform: "translate(-50%, calc(-100% - 8px))", textShadow: "0 1px 3px #02070d, 0 0 8px #02070d", fontFamily: lang === "hi" ? "var(--font-hindi)" : undefined }}>
            {l.text}
          </div>
        ))}
      </div>
      <>
        {callout && top1 && state && (
          <div key="callout" data-map-overlay className="absolute z-10 pointer-events-none" style={{ left: callout.x, top: callout.y, transform: "translate(-50%, calc(-100% - 10px))" }}>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="glass !bg-[#061422]/85 rounded-xl pr-3 py-1.5 flex items-stretch gap-2.5 shadow-[0_8px_30px_-6px_rgba(255,107,107,.45)] whitespace-nowrap">
              <span className="w-1 rounded-full bg-coral ml-1.5" />
              <div className="leading-tight">
                <div className="text-[13px] font-display font-semibold text-white">{lang === "hi" ? `#1 (${state.credible90.length} में से)` : `#1 of ${state.credible90.length}`} · {(100 * top1.p).toFixed(0)}%</div>
                <div className="text-[11px] text-coral/90 font-medium">{t_("unconfirmed")} · {L(top1).split(" · ")[0]}</div>
              </div>
            </div>
            <div className="mx-auto w-px h-[10px] bg-gradient-to-b from-coral to-transparent" />
          </motion.div>
          </div>
        )}
      </>
    </div>
  );
}
