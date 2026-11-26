import { create } from "zustand";
import { api, type DayState, type Meta, type Network } from "./api";

export type View = "intro" | "prologue" | "command" | "intake" | "escalation" | "audit" | "evidence" | "vision";
export type Focus = { lon: number; lat: number; label: string; kind: "complaint" | "test" | "alert"; at: number } | null;

type S = {
  view: View;
  lang: "en" | "hi";
  stage: boolean;
  reveal: boolean;
  role: number;
  meta: Meta | null;
  net: Network | null;
  state: DayState | null;
  prev: DayState | null;
  day: number;
  hour: number;
  playing: boolean;
  layers: { flow: boolean; plume: boolean; columns: boolean; buildings: boolean };
  focus: Focus;
  toast: { text: string; tone: "info" | "good" | "bad"; at: number } | null;
  alertAt: number;
  setView: (v: View) => void;
  toggleLang: () => void;
  toggleStage: () => void;
  toggleReveal: () => void;
  setRole: (r: number) => void;
  boot: () => Promise<void>;
  setDay: (d: number) => Promise<void>;
  setHour: (h: number) => void;
  refresh: () => Promise<void>;
  togglePlay: () => void;
  toggleLayer: (k: keyof S["layers"]) => void;
  setFocus: (f: Focus) => void;
  notify: (text: string, tone?: "info" | "good" | "bad") => void;
  reset: () => Promise<void>;
};

let timer: number | undefined;
let hourTimer: number | undefined;
let reqId = 0;

export const useStore = create<S>((set, get) => ({
  view: "intro",
  lang: "en",
  stage: false,
  reveal: false,
  role: 0,
  meta: null,
  net: null,
  state: null,
  prev: null,
  day: 5,
  hour: 18,
  playing: false,
  layers: { flow: true, plume: true, columns: true, buildings: true },
  focus: null,
  toast: null,
  alertAt: 0,
  setView: (v) => set({ view: v }),
  toggleLang: () => set({ lang: get().lang === "en" ? "hi" : "en" }),
  toggleStage: () => set({ stage: !get().stage }),
  toggleReveal: () => set({ reveal: !get().reveal }),
  setRole: (r) => set({ role: r }),
  boot: async () => {
    // deep links for presenters and testing: ?view=command&day=9&hour=18&tab=kit&reset
    const q = new URLSearchParams(window.location.search);
    if (q.has("reset")) await api.reset();
    const [meta, net] = await Promise.all([api.meta(), api.network()]);
    const view = (q.get("view") as View) || "intro";
    set({ meta, net, view, stage: q.has("stage"), lang: q.get("lang") === "hi" ? "hi" : "en",
      day: q.has("day") ? Math.max(2, +q.get("day")!) : 5, hour: q.has("hour") ? +q.get("hour")! : 18 });
    await get().refresh();
  },
  setDay: async (d) => {
    const m = get().meta;
    set({ day: Math.max(2, Math.min(d, (m?.days ?? 21) - 1)) });
    await get().refresh();
  },
  setHour: (h) => {
    set({ hour: h });
    window.clearTimeout(hourTimer);
    hourTimer = window.setTimeout(() => get().refresh(), 120);   // debounce the slider
  },
  refresh: async () => {
    const id = ++reqId;
    const s = await api.day(get().day, get().hour);
    if (id !== reqId) return;                                     // a newer request superseded this one
    const prev = get().state;
    const opened = s.status === "ALERT" && prev?.status !== "ALERT" && prev !== null;
    set({ prev, state: s, ...(opened ? { alertAt: Date.now() } : {}) });
    if (opened && get().net) {
      const n = get().net!.nodes[s.top[0].node];
      set({ focus: { lon: n.lon, lat: n.lat, label: s.top[0].label, kind: "alert", at: Date.now() } });
      if (get().playing) get().togglePlay();                       // stop on the alert: the presenter takes over
    }
  },
  togglePlay: () => {
    const playing = !get().playing;
    set({ playing });
    window.clearInterval(timer);
    if (playing) {
      timer = window.setInterval(async () => {
        const { day, meta } = get();
        if (!meta || day >= meta.days - 1) { window.clearInterval(timer); set({ playing: false }); return; }
        await get().setDay(day + 1);
      }, 1500);
    }
  },
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setFocus: (f) => set({ focus: f }),
  notify: (text, tone = "info") => set({ toast: { text, tone, at: Date.now() } }),
  reset: async () => {
    await api.reset();
    set({ day: 5, hour: 18, focus: null, reveal: false });
    await get().refresh();
  },
}));
