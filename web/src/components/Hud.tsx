import type React from "react";
import { AnimatePresence, motion, animate, useMotionValue, useTransform } from "motion/react";
import { useEffect, useMemo } from "react";
import clsx from "clsx";
import {
  Activity, AlertTriangle, Beaker, Building2, Clock, Droplets, FlaskConical, Layers, Mic, Pause, Play,
  RotateCcw, ShieldCheck, Siren, Sparkles, Waves, Link2, BarChart3, Globe2, Info,
} from "lucide-react";
import { Mark, Wordmark } from "./Logo";
import { useStore, type View } from "../store";

const STATUS = {
  ALERT: { c: "#ff6b6b", bg: "rgba(255,107,107,.14)", t: "ALERT" },
  WATCH: { c: "#f5b544", bg: "rgba(245,181,68,.14)", t: "WATCH" },
  NORMAL: { c: "#34d399", bg: "rgba(52,211,153,.12)", t: "NORMAL" },
};

function Num({ v, d = 0, suffix = "" }: { v: number; d?: number; suffix?: string }) {
  const mv = useMotionValue(v);
  const text = useTransform(mv, (x) => x.toFixed(d) + suffix);
  useEffect(() => { const c = animate(mv, v, { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }); return () => c.stop(); }, [v]);
  return <motion.span className="num">{text}</motion.span>;
}

export function Gauge({ value, status }: { value: number; status: keyof typeof STATUS }) {
  const r = 34, c = 2 * Math.PI * r, arc = 0.75;
  const col = STATUS[status].c;
  return (
    <div className="relative w-[86px] h-[86px]">
      <svg viewBox="0 0 86 86" className="absolute inset-0 -rotate-[225deg]">
        <circle cx="43" cy="43" r={r} fill="none" stroke="#14304c" strokeWidth="7" strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" />
        <motion.circle cx="43" cy="43" r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * arc} ${c}`} initial={false} animate={{ strokeDashoffset: c * arc * (1 - value / 100) }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
        <line x1="43" y1="6" x2="43" y2="14" stroke="#cfe6ff" strokeWidth="2" transform={`rotate(${0.5 * 270} 43 43)`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-display font-bold" style={{ color: col }}><Num v={value} /></div>
        <div className="text-[8px] tracking-[.18em] text-mist -mt-0.5">INDEX</div>
      </div>
    </div>
  );
}

function Spark({ data, color, h = 34, mark }: { data: number[]; color: string; h?: number; mark?: number }) {
  const w = 190, max = Math.max(...data, 1);
  const pts = data.map((v, i) => [(i / Math.max(data.length - 1, 1)) * w, h - (v / max) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs><linearGradient id={`g${color}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {mark !== undefined && <line x1={0} x2={w} y1={h - (mark / max) * (h - 4) - 2} y2={h - (mark / max) * (h - 4) - 2} stroke="#cfe6ff" strokeOpacity=".25" strokeDasharray="3 3" />}
      <motion.path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#g${color})`} initial={false} animate={{ d: `${d} L${w},${h} L0,${h} Z` }} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth="2" initial={false} animate={{ d }} transition={{ duration: 0.6 }} />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.2" fill={color} />}
    </svg>
  );
}

export function TopBar() {
  const { state, meta, layers, toggleLayer, net, reset, notify } = useStore();
  if (!state || !meta) return null;
  const st = STATUS[state.status];
  const now = new Date(state.now);
  const esc = state.escalation;
  return (
    <motion.div initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
      className="absolute top-4 left-4 right-4 z-20 flex items-stretch gap-3 pointer-events-none">
      <div className="glass rounded-2xl px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
        <Mark size={38} pulse={state.status === "ALERT"} />
        <Wordmark size={21} />
      </div>
      <div className="glass rounded-2xl px-4 py-2 flex items-center gap-4 pointer-events-auto">
        <Gauge value={state.alert_index} status={state.status} />
        <div>
          <div className="label">Ward status</div>
          <motion.div key={state.status} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 font-display font-bold text-lg"
            style={{ color: st.c, background: st.bg, boxShadow: state.status === "ALERT" ? `0 0 24px -4px ${st.c}` : undefined }}>
            <span className="relative flex w-2.5 h-2.5"><span className="absolute inset-0 rounded-full ping-soft" style={{ background: st.c }} /><span className="relative w-2.5 h-2.5 rounded-full" style={{ background: st.c }} /></span>
            {st.t}
          </motion.div>
          <div className="text-[11px] text-mist mt-1">{net?.label.split("(")[0].trim()} · threshold = ≤1 false alarm / ward / quarter</div>
        </div>
      </div>
      <div className="glass rounded-2xl px-4 py-2.5 flex items-center gap-3 pointer-events-auto min-w-[250px]">
        <Clock size={18} className="text-aqua" />
        <div>
          <div className="label">City clock</div>
          <div className="font-display text-lg num">{now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })} · {String(now.getHours()).padStart(2, "0")}:00</div>
          {esc && esc.owner ? (
            <div className={clsx("text-[11.5px]", esc.overdue_h > 0 ? "text-coral" : "text-mint")}>
              {esc.stage}: {esc.overdue_h > 0 ? `overdue ${esc.overdue_h.toFixed(0)} h` : `${esc.remaining_h.toFixed(0)} h left`}
            </div>
          ) : esc ? <div className="text-[11.5px] text-mint">Alert {esc.status}</div> : <div className="text-[11.5px] text-mist">No open alert</div>}
        </div>
      </div>
      <div className="flex-1" />
      <div className="glass rounded-2xl px-3 py-2 flex items-center gap-1.5 pointer-events-auto">
        {([["flow", Waves, "Water flow"], ["plume", Droplets, "Plume"], ["columns", BarChart3, "Probability"], ["buildings", Building2, "3D city"]] as const).map(([k, I, t]) => (
          <button key={k} onClick={() => toggleLayer(k)} title={t}
            className={clsx("flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-[10px] transition", layers[k] ? "bg-cyan/15 text-aqua" : "text-mist hover:bg-white/5")}>
            <I size={16} />{t}
          </button>
        ))}
        <div className="w-px h-8 bg-white/10 mx-1" />
        <button title="Reset the demo session" onClick={async () => { await reset(); notify("Session reset", "info"); }}
          className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-[10px] text-mist hover:bg-white/5"><RotateCcw size={16} />Reset</button>
      </div>
      <div className="glass rounded-2xl px-3 py-2 flex items-center gap-2 pointer-events-auto max-w-[220px]">
        <Info size={16} className="text-amber shrink-0" />
        <div className="text-[10.5px] leading-snug text-amber/90">Simulated scenario on real Indore streets. Pipes synthetic. Not a real event.</div>
      </div>
    </motion.div>
  );
}

export function SignalsPanel() {
  const { state, meta } = useStore();
  if (!state || !meta) return null;
  const s = state.series;
  const today = state.tests.filter((t) => t.day === state.day);
  const failed = state.tests.filter((t) => t.failed).length;
  return (
    <motion.div initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.6 }}
      className="absolute left-4 top-[132px] z-20 w-[262px] glass rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2"><Activity size={15} className="text-aqua" /><span className="label">Signals the city already has</span></div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[12.5px] text-slate-200 flex items-center gap-1.5"><Mic size={13} className="text-amber" />Complaints / day</span><span className="font-display text-amber text-lg"><Num v={s.complaints[s.complaints.length - 1] ?? 0} /></span></div>
        <Spark data={s.complaints} color="#f5b544" />
      </div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[12.5px] text-slate-200 flex items-center gap-1.5"><FlaskConical size={13} className="text-violet-300" />Pharmacy ORS / day</span><span className="font-display text-violet-300 text-lg"><Num v={s.pharmacy[s.pharmacy.length - 1] ?? 0} /></span></div>
        <Spark data={s.pharmacy} color="#a78bfa" />
      </div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[12.5px] text-slate-200 flex items-center gap-1.5"><Beaker size={13} className="text-mint" />Field tests</span><span className="text-[12px] text-mist">{today.length} today · <span className="text-coral">{failed} failed</span> total</span></div>
        <div className="flex gap-1 mt-2 flex-wrap">
          {state.tests.slice(-24).map((t, i) => (
            <motion.span key={`${t.day}-${t.node}-${i}`} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.01 }}
              className="w-2.5 h-2.5 rounded-full" style={{ background: t.failed ? "#ff6b6b" : "#34d399", opacity: t.day === state.day ? 1 : 0.45 }} />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[12.5px] text-slate-200 flex items-center gap-1.5"><Siren size={13} className="text-coral" />Alert index</span><span className="text-[11px] text-mist">50 = threshold</span></div>
        <Spark data={s.alert_index} color="#ff6b6b" mark={50} />
      </div>
      <div className="text-[10.5px] text-mist leading-snug border-t border-white/5 pt-3">Hospital admissions are <b className="text-slate-300">not</b> an input. They are the baseline we beat by a median of {meta.headline.lead_days[0]} days.</div>
    </motion.div>
  );
}

export function BeliefPanel() {
  const { state, net, setFocus } = useStore();
  const pmax = useMemo(() => (state ? Math.max(...state.top.map((t) => t.p), 1e-9) : 1), [state]);
  if (!state || !net) return null;
  const alerting = state.status === "ALERT";
  const contrib = Object.entries(state.contributions);
  const cmax = Math.max(...contrib.map(([, v]) => Math.abs(v)), 1);
  const icon: Record<string, React.ReactElement> = { complaints: <Mic size={13} />, syndromic: <FlaskConical size={13} />, tests: <Beaker size={13} /> };
  const name: Record<string, string> = { complaints: "Complaints", syndromic: "Pharmacy", tests: "Field tests" };
  return (
    <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.7 }}
      className="absolute right-4 top-[132px] z-20 w-[330px] glass rounded-2xl p-4 space-y-4 max-h-[calc(100vh-260px)] overflow-auto scrollbar-thin">
      <div className="flex items-center gap-2"><Sparkles size={15} className="text-coral" /><span className="label">Most likely ingress segments</span></div>
      <AnimatePresence mode="popLayout">
        {alerting ? state.top.slice(0, 4).map((t, k) => (
          <motion.button layout key={t.node} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            onClick={() => setFocus({ lon: net.nodes[t.node].lon, lat: net.nodes[t.node].lat, label: t.label, kind: "test", at: Date.now() })}
            className="w-full text-left group">
            <div className="flex items-center gap-3">
              <div className={clsx("w-7 h-7 rounded-lg grid place-items-center font-display font-bold text-sm", k === 0 ? "bg-coral text-abyss" : "bg-white/8 text-slate-200")}>{k + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-slate-100 truncate group-hover:text-aqua transition">{t.label}</div>
                <div className="h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#f5b544,#ff6b6b)" }}
                    initial={{ width: 0 }} animate={{ width: `${(100 * t.p) / pmax}%` }} transition={{ duration: 0.8 }} />
                </div>
              </div>
              <div className="font-display text-lg w-12 text-right"><Num v={100 * t.p} suffix="%" /></div>
            </div>
          </motion.button>
        )) : (
          <motion.div key="calm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-mist leading-relaxed">
            <ShieldCheck size={18} className="text-mint mb-2" />
            Signals are within normal variation. The engine is watching every junction, but there is no alert.<br />
            <span className="text-amber/90">No alert does not mean safe.</span> Field tests remain the ground truth.
          </motion.div>
        )}
      </AnimatePresence>
      {alerting && (
        <>
          <div className="text-[11px] text-mist">The true segment sits inside this ranked set of {state.credible90.length} (90% credible) · onset estimated day {state.map_onset}</div>
          <div className="border-t border-white/5 pt-3">
            <div className="label mb-2">Why here? Evidence vs. "no event"</div>
            {contrib.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 mb-1.5">
                <span className="w-24 text-[12px] text-slate-300 flex items-center gap-1.5">{icon[k]}{name[k] ?? k}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: v >= 0 ? "linear-gradient(90deg,#22a6f2,#67e8f9)" : "#64748b" }}
                    initial={false} animate={{ width: `${(100 * Math.max(0, v)) / cmax}%` }} transition={{ duration: 0.8 }} />
                </div>
                <span className="w-12 text-right text-[12px] num text-slate-300">{v >= 0 ? "+" : ""}{v.toFixed(1)}</span>
              </div>
            ))}
            <div className="text-[10.5px] text-mist">log-likelihood ratio at the most likely hypothesis</div>
          </div>
          <div className="border-t border-white/5 pt-3">
            <div className="label mb-2 flex items-center gap-1.5"><Layers size={12} />Next field tests</div>
            {state.suggested.map((s) => (
              <button key={s.node} onClick={() => setFocus({ lon: net.nodes[s.node].lon, lat: net.nodes[s.node].lat, label: s.label, kind: "test", at: Date.now() })}
                className="w-full flex items-center gap-2 text-[12.5px] py-1 text-slate-200 hover:text-aqua">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400" />{s.label}
              </button>
            ))}
            <div className="text-[10.5px] text-mist">Chosen to narrow down the location fastest (expected information gain).</div>
          </div>
        </>
      )}
    </motion.div>
  );
}

export function Timeline() {
  const { state, meta, day, setDay, playing, togglePlay, hour, setHour } = useStore();
  if (!state || !meta) return null;
  const days = Array.from({ length: meta.days }, (_, i) => i);
  const comp = state.series.complaints;
  const cmax = Math.max(...comp, 1);
  const testsBy = new Map<number, { f: number; p: number }>();
  state.tests.forEach((t) => { const x = testsBy.get(t.day) ?? { f: 0, p: 0 }; t.failed ? x.f++ : x.p++; testsBy.set(t.day, x); });
  return (
    <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }}
      className="absolute left-4 right-4 bottom-4 z-20 glass rounded-2xl px-5 py-3 flex items-center gap-5">
      <button onClick={togglePlay} className="w-11 h-11 rounded-full grid place-items-center bg-gradient-to-br from-aqua to-cyan text-abyss shadow-[0_0_24px_-6px_rgba(103,232,249,.8)] shrink-0">
        {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
      </button>
      <div className="flex-1">
        <div className="relative h-[46px]">
          <div className="absolute inset-x-0 bottom-3 flex items-end gap-[3px] h-8">
            {days.map((d) => (
              <button key={d} onClick={() => d >= 2 && setDay(d)} className="flex-1 h-full flex flex-col justify-end items-center gap-[2px] group">
                <motion.div className="w-full rounded-sm" style={{ background: d <= state.day ? "linear-gradient(0deg,#b4741a,#f5b544)" : "#173350" }}
                  initial={false} animate={{ height: `${Math.max(6, (100 * (comp[d] ?? 0)) / cmax)}%`, opacity: d <= state.day ? 1 : 0.5 }} />
              </button>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex gap-[3px]">
            {days.map((d) => (
              <div key={d} className="flex-1 flex justify-center gap-[2px] h-2">
                {d <= state.day && testsBy.get(d)?.f ? <span className="w-1.5 h-1.5 rounded-full bg-coral" /> : null}
                {d <= state.day && testsBy.get(d)?.p ? <span className="w-1.5 h-1.5 rounded-full bg-mint/70" /> : null}
              </div>
            ))}
          </div>
          {state.status === "ALERT" && (
            <div className="absolute top-0 h-full pointer-events-none" style={{ left: `${(100 * (meta.alarm_day + 0.5)) / meta.days}%` }}>
              <div className="w-px h-full bg-coral/70" /><div className="absolute -top-1 -translate-x-1/2 text-[10px] text-coral font-semibold whitespace-nowrap flex items-center gap-1"><AlertTriangle size={10} />alert</div>
            </div>
          )}
          <motion.div className="absolute top-0 h-full pointer-events-none" initial={false} animate={{ left: `${(100 * (day + 0.5)) / meta.days}%` }} transition={{ type: "spring", stiffness: 200, damping: 25 }}>
            <div className="w-0.5 h-full bg-aqua shadow-[0_0_12px_#67e8f9]" />
          </motion.div>
        </div>
        <div className="flex justify-between text-[10px] text-mist mt-1 num">
          {days.filter((d) => d % 2 === 0).map((d) => <span key={d}>Day {d}</span>)}
        </div>
      </div>
      <div className="w-[150px] shrink-0">
        <div className="label">Hour {String(hour).padStart(2, "0")}:00</div>
        <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(+e.target.value)} className="w-full accent-cyan-400" />
        <div className="text-[10.5px] text-mist">Day <span className="text-white num">{day}</span> · drag bars or press play</div>
      </div>
    </motion.div>
  );
}

const NAV: { v: View; label: string; I: any }[] = [
  { v: "command", label: "Command", I: Globe2 },
  { v: "intake", label: "Intake", I: Mic },
  { v: "escalation", label: "Escalation", I: Siren },
  { v: "audit", label: "Audit", I: Link2 },
  { v: "evidence", label: "Evidence", I: BarChart3 },
  { v: "vision", label: "2036", I: Sparkles },
];

export function Dock() {
  const { view, setView, state } = useStore();
  return (
    <motion.div initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.9 }}
      className="absolute left-1/2 -translate-x-1/2 bottom-[104px] z-50 glass rounded-2xl p-1.5 flex gap-1 !bg-[#061422]/90">
      {NAV.map(({ v, label, I }) => (
        <button key={v} onClick={() => setView(v)}
          className={clsx("relative flex items-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-medium transition", view === v ? "text-abyss" : "text-slate-300 hover:bg-white/5")}>
          {view === v && <motion.span layoutId="dock" className="absolute inset-0 rounded-xl bg-gradient-to-r from-aqua to-cyan" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
          <I size={15} className="relative" /><span className="relative">{label}</span>
          {v === "escalation" && state?.escalation?.overdue_h ? <span className="relative w-2 h-2 rounded-full bg-coral ping-soft" /> : null}
        </button>
      ))}
    </motion.div>
  );
}

export function Toast() {
  const { toast } = useStore();
  return (
    <AnimatePresence>
      {toast && Date.now() - toast.at < 4200 && (
        <motion.div key={toast.at} initial={{ y: -20, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -10 }}
          className={clsx("absolute top-[132px] left-1/2 -translate-x-1/2 z-50 glass rounded-full px-5 py-2.5 text-[13px] font-medium",
            toast.tone === "good" ? "text-mint" : toast.tone === "bad" ? "text-coral" : "text-aqua")}>
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
