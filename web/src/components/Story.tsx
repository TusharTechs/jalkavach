import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, X } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";

type Step = { at: number; caption: string; run?: () => Promise<void> | void };

/** Hands-free narrated walkthrough (~75 s). Every number shown is computed live by the engine. */
export function useStory() {
  const [on, setOn] = useState(false);
  const [caption, setCaption] = useState("");
  const timers = useRef<number[]>([]);
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; setOn(false); setCaption(""); };
  const start = async () => {
    stop();
    const s = useStore.getState();
    await api.reset();
    const meta = s.meta!;
    const A = meta.alarm_day;
    const st = () => useStore.getState();
    // switch drawers via the map view so exit/enter animations never race
    const go = (v: "escalation" | "audit" | "evidence" | "vision" | "command") => { s.setView("command"); window.setTimeout(() => s.setView(v), 450); };
    const steps: Step[] = [
      { at: 0, caption: "Ward 00, Demo Nagar. Real Indore streets; simulated pipes. Day 4, 7 am: supply is on and water flows from the tank.",
        run: async () => { s.setView("command"); useStore.setState({ day: 4, hour: 7, reveal: false }); await st().refresh(); } },
      { at: 6500, caption: "Noon: supply is off. Pipes sit at low pressure. The amber glow marks where sewage can most easily get in.",
        run: async () => { useStore.setState({ hour: 12 }); await st().refresh(); } },
      { at: 13000, caption: "Day by day, complaints arrive as isolated tickets: a smell here, yellow water there. Pharmacy ORS sales stay near normal.",
        run: async () => { useStore.setState({ hour: 18 }); for (let d = 5; d < A; d++) { await st().setDay(d); await new Promise((r) => setTimeout(r, 1300)); } } },
      { at: 13000 + (A - 5) * 1300 + 600, caption: "The engine weighs every junction, every onset day and \"nothing is happening\" together. Evidence crosses the city's threshold: alert.",
        run: async () => { await st().setDay(A); } },
      { at: 13000 + (A - 5) * 1300 + 7600, caption: "The search area shrinks from the whole ward to a few hundred metres of pipe, ranked, with the odds shown and marked unconfirmed." },
      { at: 13000 + (A - 5) * 1300 + 14000, caption: "A resident's Hindi voice note is understood and pinned near the park. The ranking updates.",
        run: async () => { await api.addComplaint("भैया, पार्क के पास नल में पीला पानी आ रहा है, बदबू भी है।", A, 19); await st().setDay(A); s.setFocus(null); } },
      { at: 13000 + (A - 5) * 1300 + 21000, caption: "The city's clock starts. The ward engineer acknowledges within the SLA; every step is recorded.",
        run: async () => { go("escalation"); await new Promise((r) => setTimeout(r, 2200)); await api.action("acknowledge", meta.policy.stages[0].owner, A, 20); useStore.setState({ hour: 20 }); await st().refresh(); } },
      { at: 13000 + (A - 5) * 1300 + 28000, caption: "A tamper-evident trail: who acted, and when. It protects the officers who act on time.",
        run: () => go("audit") },
      { at: 13000 + (A - 5) * 1300 + 34000, caption: "Tested on held-out simulated scenarios, pre-registered, with what didn't work shown too.",
        run: () => go("evidence") },
      { at: 13000 + (A - 5) * 1300 + 41000, caption: "One ward, then 85, then Simhastha 2028, then every AMRUT city. Safai humne sikhayi. Ab suraksha bhi.",
        run: () => go("vision") },
      { at: 13000 + (A - 5) * 1300 + 49000, caption: "", run: () => { stop(); } },
    ];
    setOn(true);
    steps.forEach((x) => timers.current.push(window.setTimeout(async () => { setCaption(x.caption); await x.run?.(); }, x.at)));
  };
  useEffect(() => () => stop(), []);
  return { on, caption, start, stop };
}

export function StoryCaption({ on, caption, stop }: { on: boolean; caption: string; stop: () => void }) {
  return (
    <AnimatePresence>
      {on && caption && (
        <motion.div key={caption} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          className="absolute left-1/2 -translate-x-1/2 bottom-[196px] z-[65] max-w-[900px] glass !bg-[#061422]/92 rounded-2xl px-6 py-3.5 text-[19px] font-display text-slate-50 text-center leading-snug flex items-center gap-4">
          <Clapperboard size={18} className="text-aqua shrink-0" /><span>{caption}</span>
          <button onClick={stop} className="text-mist hover:text-white shrink-0"><X size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
