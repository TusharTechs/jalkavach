import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, Volume2, VolumeX, X } from "lucide-react";
import { api } from "../api";
import { useStore, type View } from "../store";

type Step = { at: number; caption: string | (() => string); run?: () => Promise<void> | void };

/** The demo complaint the story plays (its landmark must exist in the ward gazetteer). */
export const STORY_COMPLAINT = "भिया, पार्क के पास नल में पीला पानी आ रहा है, बदबू भी है।";
/** This ward has several parks, so the story shows the officer choosing which one. */
export const STORY_PLACE = "Park 4";

function speak(text: string, on: boolean) {
  try {
    window.speechSynthesis?.cancel();
    if (!on || !text || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text.replace(/·/g, ","));
    const v = window.speechSynthesis.getVoices().find((x) => x.lang === "en-IN") ?? null;
    if (v) u.voice = v;
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch { /* narration is optional */ }
}

/** Hands-free narrated walkthrough (~65 s). Every number shown is computed live by the engine. */
export function useStory() {
  const [on, setOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [voice, setVoice] = useState(true);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const timers = useRef<number[]>([]);
  const prevStage = useRef(false);
  const stop = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    speak("", false);
    if (on) useStore.setState({ stage: prevStage.current });
    setOn(false); setCaption("");
  };
  const start = async () => {
    stop();
    const s = useStore.getState();
    prevStage.current = s.stage;
    await api.reset();
    const meta = s.meta!;
    const A = meta.alarm_day;
    const st = () => useStore.getState();
    const go = (v: View) => s.setView(v);
    const at = async (d: number, h: number) => { useStore.setState({ day: d, hour: h }); await st().refresh(); };
    const owner = (k: number) => meta.policy.stages[k].owner;
    const T = 13000 + (A - 5) * 1300;
    const steps: Step[] = [
      { at: 0, caption: "Ward 00, Demo Nagar. Real Indore streets; simulated pipes. Day 4, 7 am: supply is on and water flows from the tank.",
        run: async () => { useStore.setState({ stage: true, reveal: false }); go("command"); await at(4, 7); } },
      { at: 6500, caption: "Noon: supply is off and the pipes sit at low pressure. The violet haze marks where sewage can most easily get in.",
        run: () => at(4, 12) },
      { at: 13000, caption: "Day by day, complaints arrive as isolated tickets: a smell here, yellow water there. Pharmacy ORS sales stay near normal.",
        run: async () => { useStore.setState({ hour: 18 }); for (let d = 5; d < A; d++) { await st().setDay(d); await new Promise((r) => setTimeout(r, 1300)); } } },
      { at: T + 600, caption: "The engine weighs every junction, every onset day and \"nothing is happening\" together. Evidence crosses the city's threshold: alert.",
        run: () => at(A, 18) },
      { at: T + 7600, caption: () => {
          const x = st().state!;
          return `The alert opens the search: from ${x.total_km.toFixed(1)} km of pipe to ${x.search_km.toFixed(1)} km, ranked, every row marked unconfirmed. Not yet a location: a place to start testing.`;
        } },
      { at: T + 14500, caption: "7 pm: a resident's Hindi voice note: “near the park”, but several parks match, so nothing is pinned until the officer calls back and the resident says Park 4.",
        run: async () => {
          const p = (await api.parse(STORY_COMPLAINT)).parsed;
          const o = p.options.find((x) => x.name === STORY_PLACE) ?? p.options[0];
          await api.addComplaint(STORY_COMPLAINT, A, 19, "voice note", o ? o.node : null); await at(A, 19); s.setFocus(null);
        } },
      { at: T + 21500, caption: "The city's clock starts. 8 pm: the ward's Assistant Engineer acknowledges, well within the SLA. The clock turns green.",
        run: async () => { go("escalation"); await new Promise((r) => setTimeout(r, 1800)); await api.action("acknowledge", owner(0), A, 20); await at(A, 20); } },
      { at: T + 28500, caption: "Next morning the field team logs its tests, and the day's routine chlorine checks include two failures near the complaints. The 6 pm run narrows the search.",
        run: async () => { await api.action("samples", owner(1), A + 1, 11); go("command"); await at(A + 1, 11); } },
      { at: T + 34000, caption: () => {
          const x = st().state!;
          return `Day ${A + 1}, 6 pm: the search is down to ${x.search_km.toFixed(1)} km of pipe and ${x.credible90.length} junctions. About ${x.exposed_people.toLocaleString("en-IN")} residents are on those pipes.`;
        }, run: () => at(A + 1, 18) },
      { at: T + 41000, caption: "The Executive Engineer confirms; drafts are generated, and the Health Officer approves the Hindi advisory. JalKavach itself never sends anything.",
        run: async () => {
          await api.action("confirm", owner(2), A + 1, 19); go("escalation"); await at(A + 1, 19);
          await new Promise((r) => setTimeout(r, 2600));
          await api.action("approve_advisory", meta.policy.advisory_approver, A + 1, 20); await at(A + 1, 20);
        } },
      { at: T + 50000, caption: "A tamper-evident trail of people acting on time: engineer, field team, Executive Engineer, Health Officer.",
        run: () => go("audit") },
      { at: T + 57000, caption: "Tested on held-out simulated scenarios, pre-registered, with what didn't work shown too.",
        run: () => go("evidence") },
      { at: T + 64000, caption: "One ward, then 85, then Simhastha 2028, then every AMRUT city. Swachhta mein number one. Ab suraksha mein bhi.",
        run: () => go("vision") },
      { at: T + 72000, caption: "", run: () => { stop(); } },
    ];
    setOn(true);
    steps.forEach((x) => timers.current.push(window.setTimeout(async () => {
      if (x.run) await x.run();
      const c = typeof x.caption === "function" ? x.caption() : x.caption;
      setCaption(c); speak(c, voiceRef.current);
    }, x.at)));
  };
  useEffect(() => () => { timers.current.forEach(clearTimeout); speak("", false); }, []);
  return { on, caption, start, stop, voice, setVoice };
}

export function StoryCaption({ on, caption, stop, voice, setVoice }: { on: boolean; caption: string; stop: () => void; voice: boolean; setVoice: (v: boolean) => void }) {
  return (
    <AnimatePresence>
      {on && caption && (
        <motion.div key={caption} role="status" aria-live="polite" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          className="absolute left-1/2 -translate-x-1/2 top-[124px] z-[65] w-[min(860px,calc(var(--hud-w)-880px))] glass !bg-[#061422]/94 rounded-2xl px-6 py-3.5 text-[19px] font-display text-slate-50 leading-snug flex items-center gap-4">
          <Clapperboard size={18} className="text-aqua shrink-0" aria-hidden /><span className="flex-1">{caption}</span>
          <button aria-label={voice ? "Mute narration" : "Narrate"} onClick={() => { setVoice(!voice); if (voice) window.speechSynthesis?.cancel(); }} className="text-mist hover:text-white shrink-0">{voice ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
          <button aria-label="Stop the story (Esc)" onClick={stop} className="text-mist hover:text-white shrink-0"><X size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
