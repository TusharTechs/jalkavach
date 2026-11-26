import { create } from "zustand";
import { api, type DayState, type Meta, type Network } from "./api";

export type View = "intro" | "command" | "intake" | "escalation" | "audit" | "evidence" | "vision";
export type Focus = { lon: number; lat: number; label: string; kind: "complaint" | "test"; at: number } | null;

type S = {
  view: View;
  meta: Meta | null;
  net: Network | null;
  state: DayState | null;
  prev: DayState | null;
  day: number;
  hour: number;
  playing: boolean;
  loading: boolean;
  layers: { flow: boolean; plume: boolean; columns: boolean; buildings: boolean };
  focus: Focus;
  toast: { text: string; tone: "info" | "good" | "bad"; at: number } | null;
  setView: (v: View) => void;
  boot: () => Promise<void>;
  setDay: (d: number) => Promise<void>;
  setHour: (h: number) => Promise<void>;
  refresh: () => Promise<void>;
  togglePlay: () => void;
  toggleLayer: (k: keyof S["layers"]) => void;
  setFocus: (f: Focus) => void;
  notify: (text: string, tone?: "info" | "good" | "bad") => void;
  reset: () => Promise<void>;
};

let timer: number | undefined;

export const useStore = create<S>((set, get) => ({
  view: "intro",
  meta: null,
  net: null,
  state: null,
  prev: null,
  day: 5,
  hour: 17,
  playing: false,
  loading: false,
  layers: { flow: true, plume: true, columns: true, buildings: true },
  focus: null,
  toast: null,
  setView: (v) => set({ view: v }),
  boot: async () => {
    // deep links for presenters and testing: ?view=command&day=9&hour=17&tab=kit
    const q = new URLSearchParams(window.location.search);
    if (!q.has("keep")) await api.reset();
    const [meta, net] = await Promise.all([api.meta(), api.network()]);
    const view = (q.get("view") as View) || "intro";
    set({ meta, net, view, day: q.has("day") ? Math.max(2, +q.get("day")!) : 5, hour: q.has("hour") ? +q.get("hour")! : 17 });
    await get().refresh();
  },
  setDay: async (d) => {
    const m = get().meta;
    const day = Math.max(2, Math.min(d, (m?.days ?? 21) - 1));
    set({ day });
    await get().refresh();
  },
  setHour: async (h) => { set({ hour: h }); await get().refresh(); },
  refresh: async () => {
    set({ loading: true });
    const s = await api.day(get().day, get().hour);
    set({ prev: get().state, state: s, loading: false });
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
      }, 1700);
    }
  },
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setFocus: (f) => set({ focus: f }),
  notify: (text, tone = "info") => set({ toast: { text, tone, at: Date.now() } }),
  reset: async () => {
    await api.reset();
    set({ day: 5, hour: 17, focus: null });
    await get().refresh();
  },
}));
