import type React from "react";
import { AnimatePresence, motion, animate, useMotionValue, useTransform } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  Activity, AlertTriangle, Beaker, Building2, Clock, Droplets, FlaskConical, Layers, Mic, Pause, Play,
  RotateCcw, ShieldCheck, Siren, Sparkles, Waves, Link2, BarChart3, Globe2, Eye, EyeOff, Search, MonitorUp,
} from "lucide-react";
import { Mark, Wordmark } from "./Logo";
import { useStore, type View } from "../store";
import { useT } from "../i18n";

const STATUS = {
  ALERT: { c: "#ff6b6b", bg: "rgba(255,107,107,.14)" },
  NORMAL: { c: "#34d399", bg: "rgba(52,211,153,.12)" },
};

export function Num({ v, d = 0, suffix = "" }: { v: number; d?: number; suffix?: string }) {
  const mv = useMotionValue(v);
  const text = useTransform(mv, (x) => x.toFixed(d) + suffix);
  useEffect(() => { const c = animate(mv, v, { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }); return () => c.stop(); }, [v]);
  return <motion.span className="num">{text}</motion.span>;
}

export function Gauge({ value, status }: { value: number; status: keyof typeof STATUS }) {
  const r = 34, c = 2 * Math.PI * r, arc = 0.75;
  const col = STATUS[status].c;
  return (
    <div className="relative w-[84px] h-[84px] shrink-0">
      <svg viewBox="0 0 86 86" className="absolute inset-0 -rotate-[225deg]">
        <circle cx="43" cy="43" r={r} fill="none" stroke="#14304c" strokeWidth="7" strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" />
        <motion.circle cx="43" cy="43" r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * arc} ${c}`} initial={false} animate={{ strokeDashoffset: c * arc * (1 - value / 100) }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
        <line x1="43" y1="5" x2="43" y2="14" stroke="#cfe6ff" strokeWidth="2.5" transform={`rotate(${0.5 * 270} 43 43)`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[26px] font-display font-bold leading-none" style={{ color: col }}><Num v={value} /></div>
      </div>
    </div>
  );
}

function Spark({ data, color, max, base, mark, w = 214, h = 38 }: { data: number[]; color: string; max: number; base?: number; mark?: number; w?: number; h?: number }) {
  const days = 21;
  const y = (v: number) => h - (Math.min(v, max) / max) * (h - 4) - 2;
  const pts = data.map((v, i) => [(i / (days - 1)) * w, y(v)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs><linearGradient id={`g${color}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {base !== undefined && <rect x={0} width={w} y={y(base * 1.25)} height={Math.max(1, y(base * 0.75) - y(base * 1.25))} fill="#cfe6ff" fillOpacity=".06" />}
      {mark !== undefined && <line x1={0} x2={w} y1={y(mark)} y2={y(mark)} stroke="#cfe6ff" strokeOpacity=".3" strokeDasharray="3 3" />}
      {pts.length > 1 && <path d={`${d} L${last[0]},${h} L0,${h} Z`} fill={`url(#g${color})`} />}
      {pts.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth="2" />}
      {last && <circle cx={last[0]} cy={last[1]} r="3.4" fill={color} />}
    </svg>
  );
}

export function TopBar() {
  const { state, meta, reset, notify, lang, toggleLang, toggleStage, stage } = useStore();
  const t = useT();
  if (!state || !meta) return null;
  const st = STATUS[state.status];
  const esc = state.escalation;
  return (
    <motion.div initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
      className="absolute top-4 left-4 right-4 z-30 flex items-stretch gap-3 pointer-events-none">
      <div className="glass rounded-2xl pl-3 pr-5 py-2 flex items-center gap-4 pointer-events-auto">
        <Mark size={44} pulse={state.status === "ALERT"} />
        <Wordmark size={23} />
        <div className="w-px self-stretch bg-white/10 mx-1" />
        <Gauge value={state.alert_index} status={state.status} />
        <div>
          <div className="label">{t("Ward status")} · Ward 00</div>
          <motion.div key={state.status} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300 }}
            className="mt-1 inline-flex items-center gap-2 rounded-full px-3.5 py-1 font-display font-bold text-xl"
            style={{ color: st.c, background: st.bg, boxShadow: state.status === "ALERT" ? `0 0 26px -4px ${st.c}` : undefined }}>
            <span className="relative flex w-2.5 h-2.5"><span className="absolute inset-0 rounded-full ping-soft" style={{ background: st.c }} /><span className="relative w-2.5 h-2.5 rounded-full" style={{ background: st.c }} /></span>
            <span className={lang === "hi" ? "font-hindi" : ""}>{t(state.status)}</span>
          </motion.div>
          <div className="text-[11px] text-mist mt-1 whitespace-nowrap">{t("Alert index")}: 50 = city threshold · not a probability</div>
        </div>
      </div>
      <div className="glass rounded-2xl px-4 py-2.5 flex items-center gap-3 pointer-events-auto min-w-[260px]">
        <Clock size={20} className="text-aqua" />
        <div>
          <div className="label">{t("City clock")} · simulation</div>
          <div className="font-display text-xl num">Day {state.day} · {String(state.hour).padStart(2, "0")}:00
            <span className={clsx("ml-2 text-[11px] font-sans align-middle px-2 py-0.5 rounded-full", state.supply_on ? "bg-cyan/15 text-aqua" : "bg-amber/10 text-amber")}>
              {state.supply_on ? "supply ON" : "supply OFF"}</span></div>
          {esc && esc.owner ? (
            <div className={clsx("text-[12px] font-medium", esc.overdue_h > 0 ? "text-coral" : "text-mint")}>
              {esc.stage}: {esc.overdue_h > 0 ? `overdue ${esc.overdue_h.toFixed(0)} h` : `due in ${esc.remaining_h.toFixed(0)} h`}
            </div>
          ) : esc ? <div className="text-[12px] text-mint">Alert {esc.status}</div> : <div className="text-[12px] text-mist">{t("No open alert")}</div>}
        </div>
      </div>
      <div className="flex-1" />
      <div className="glass rounded-2xl px-2 py-2 flex items-center gap-1 pointer-events-auto">
        <button title="हिंदी / English (H)" onClick={toggleLang} className="w-12 h-12 rounded-xl grid place-items-center hover:bg-white/5">
          <span className="font-hindi text-[17px] text-aqua" style={{ letterSpacing: 0 }}>{lang === "en" ? "हिं" : "EN"}</span>
        </button>
        <button title="Stage mode: larger type (S)" onClick={toggleStage} className={clsx("w-12 h-12 rounded-xl grid place-items-center", stage ? "bg-cyan/15 text-aqua" : "text-mist hover:bg-white/5")}><MonitorUp size={19} /></button>
        <button title="Reset the demo session" onClick={async () => { await reset(); notify("Session reset", "info"); }} className="w-12 h-12 rounded-xl grid place-items-center text-mist hover:bg-white/5"><RotateCcw size={18} /></button>
      </div>
      <div className="rounded-2xl px-4 flex items-center pointer-events-auto border border-white/25 bg-abyss/60">
        <div className="text-[11px] leading-tight tracking-[.16em] text-slate-200 font-semibold">SIMULATED<br />SCENARIO</div>
      </div>
    </motion.div>
  );
}

export function SignalsPanel() {
  const { state, meta, stage } = useStore();
  const t = useT();
  if (!state || !meta || stage) return null;
  const s = state.series;
  const today = state.tests.filter((x) => x.day === state.day);
  const failed = state.tests.filter((x) => x.failed).length;
  return (
    <motion.div initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.5 }}
      className="absolute left-4 top-[124px] z-20 w-[250px] glass rounded-2xl p-4 space-y-3.5">
      <div className="flex items-center gap-2"><Activity size={15} className="text-aqua" /><span className="label">{t("Ward signals")}</span></div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[13px] text-slate-200 flex items-center gap-1.5"><Mic size={13} className="text-amber" />{t("Complaints / day")}</span><span className="font-display text-amber text-2xl"><Num v={s.complaints[s.complaints.length - 1] ?? 0} /></span></div>
        <Spark data={s.complaints} color="#f5b544" max={meta.scales.complaints} />
      </div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[13px] text-slate-200 flex items-center gap-1.5"><FlaskConical size={13} className="text-violet-300" />{t("Pharmacy ORS / day")}</span><span className="font-display text-violet-300 text-2xl"><Num v={s.pharmacy[s.pharmacy.length - 1] ?? 0} /></span></div>
        <Spark data={s.pharmacy} color="#a78bfa" max={meta.scales.pharmacy} base={meta.scales.pharmacy_base} />
        <div className="text-[10.5px] text-mist">partner pharmacies, by agreement · band = normal range</div>
      </div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[13px] text-slate-200 flex items-center gap-1.5"><Beaker size={13} className="text-mint" />{t("Field tests")}</span><span className="text-[12px] text-mist">{today.length} {t("today")} · <span className="text-coral">{failed}</span> {t("failed total")}</span></div>
        <div className="flex gap-1 mt-2 flex-wrap">
          {state.tests.slice(-26).map((x, i) => (
            <span key={`${x.day}-${x.node}-${i}`} className="w-2.5 h-2.5 rounded-full" style={{ background: x.failed ? "#ff6b6b" : "#34d399", opacity: x.day === state.day ? 1 : 0.45 }} />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-between"><span className="text-[13px] text-slate-200 flex items-center gap-1.5"><Siren size={13} className="text-coral" />{t("Alert index")}</span><span className="text-[11px] text-mist">{t("50 = threshold")}</span></div>
        <Spark data={s.alert_index} color="#ff6b6b" max={100} mark={50} />
      </div>
    </motion.div>
  );
}

export function BeliefPanel() {
  const { state, net, setFocus, reveal, toggleReveal } = useStore();
  const t = useT();
  const pmax = useMemo(() => (state ? Math.max(...state.top.map((x) => x.p), 1e-9) : 1), [state]);
  if (!state || !net) return null;
  const alerting = state.status === "ALERT";
  const contrib = Object.entries(state.contributions);
  const cmax = Math.max(...contrib.map(([, v]) => Math.abs(v)), 1);
  const icon: Record<string, React.ReactElement> = { complaints: <Mic size={13} />, syndromic: <FlaskConical size={13} />, tests: <Beaker size={13} /> };
  const name: Record<string, string> = { complaints: "Complaints", syndromic: "Pharmacy", tests: "Field tests" };
  const N = state.credible90.length;
  const top3 = state.top.slice(0, 3).reduce((a, x) => a + x.p, 0);
  return (
    <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.6 }}
      className="absolute right-4 top-[124px] z-20 w-[350px] glass rounded-2xl p-4 space-y-4 max-h-[calc(100vh-300px)] overflow-auto scrollbar-thin">
      {alerting ? (
        <>
          <div className="rounded-xl bg-black/25 border border-white/5 p-3">
            <div className="label flex items-center gap-1.5"><Search size={12} />Where to dig: search area</div>
            <div className="flex items-baseline gap-2 mt-1 font-display">
              <span className="text-mist text-xl line-through decoration-coral/60"><Num v={state.total_km} d={1} /> km</span>
              <span className="text-mist">→</span>
              <span className="text-[34px] font-bold text-white leading-none"><Num v={state.search_km} d={1} /></span><span className="text-lg text-white">km of pipe</span>
            </div>
            <div className="text-[11px] text-mist mt-1">pipes touching the 90% credible set ({N} of {net.nodes.length} junctions)</div>
          </div>
          <div className="flex items-center gap-2"><Sparkles size={15} className="text-coral" /><span className="label">{t("Probable ingress · unconfirmed")}</span></div>
          <AnimatePresence mode="popLayout">
            {state.top.slice(0, 4).map((x, k) => (
              <motion.button layout key={x.node} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                onClick={() => setFocus({ lon: net.nodes[x.node].lon, lat: net.nodes[x.node].lat, label: x.label, kind: "test", at: Date.now() })}
                className="w-full text-left group">
                <div className="flex items-center gap-3">
                  <div className={clsx("w-8 h-8 rounded-lg grid place-items-center font-display font-bold text-sm shrink-0", k === 0 ? "bg-coral text-abyss" : "bg-white/8 text-slate-200")}>#{k + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-slate-100 truncate group-hover:text-aqua transition">{x.label}</div>
                    <div className="h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                      <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#f5b544,#ff6b6b)" }}
                        initial={{ width: 0 }} animate={{ width: `${(100 * x.p) / pmax}%` }} transition={{ duration: 0.8 }} />
                    </div>
                  </div>
                  <div className="font-display text-lg w-12 text-right"><Num v={100 * x.p} suffix="%" /></div>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
          <div className="text-[11.5px] text-mist">Top 3 hold {(100 * top3).toFixed(0)}% of the probability · 90% credible set: {N} junctions · onset est. day {state.onset_range[0]}{state.onset_range[1] !== state.onset_range[0] ? `–${state.onset_range[1]}` : ""}</div>
          <div className="border-t border-white/5 pt-3">
            <div className="label mb-2">{t('Why here? Evidence vs. "no event"')}</div>
            {contrib.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 mb-1.5">
                <span className="w-24 text-[12px] text-slate-300 flex items-center gap-1.5">{icon[k]}{name[k] ?? k}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: v >= 0 ? "linear-gradient(90deg,#22a6f2,#67e8f9)" : "#64748b" }}
                    initial={false} animate={{ width: `${(100 * Math.max(0, v)) / cmax}%` }} transition={{ duration: 0.8 }} />
                </div>
                <span className="w-12 text-right text-[12px] num text-slate-300">{Math.abs(v) < 0.05 ? "0.0" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`}</span>
              </div>
            ))}
            <div className="text-[10.5px] text-mist">how strongly each signal favours "an event here" over "nothing is happening" (log-likelihood ratio)</div>
          </div>
          <div className="border-t border-white/5 pt-3">
            <div className="label mb-2 flex items-center gap-1.5"><Layers size={12} />{t("Suggested test taps")}</div>
            {state.suggested.map((x) => (
              <button key={x.node} onClick={() => setFocus({ lon: net.nodes[x.node].lon, lat: net.nodes[x.node].lat, label: x.label, kind: "test", at: Date.now() })}
                className="w-full flex items-center gap-2 text-[12.5px] py-1 text-slate-200 hover:text-aqua text-left">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 shrink-0" />{x.label}
              </button>
            ))}
            <div className="text-[10.5px] text-mist">Chosen by expected information gain (tested vs. random: median 6 vs 10 tests; CIs overlap).</div>
          </div>
          {state.truth && (
            <div className="border-t border-white/5 pt-3">
              <button onClick={toggleReveal} className="flex items-center gap-2 text-[12px] text-mist hover:text-white">{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? "Hide" : "Reveal"} simulated truth (R)</button>
              {reveal && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-xl border border-amber/30 bg-amber/5 p-3 text-[12.5px] text-amber">
                  Simulated truth: <b>{state.truth.label}</b>, onset day {state.truth.onset_day}. The engine currently ranks it <b>#{state.truth.rank}</b>.
                </motion.div>
              )}
            </div>
          )}
        </>
      ) : (
        <motion.div key="calm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-mint" /><span className="label">Engine status</span></div>
          <div className="text-[13.5px] text-slate-200 leading-relaxed">Signals are within normal variation. The engine re-checks every junction each day at 18:00. Search area: the whole ward, <b className="text-white">{state.total_km.toFixed(1)} km</b> of pipe.</div>
          <div className="text-[13px] text-amber/90">{t("No alert does not mean safe.")} Field tests remain the ground truth.</div>
        </motion.div>
      )}
    </motion.div>
  );
}

export function Timeline() {
  const { state, meta, day, setDay, playing, togglePlay, hour, setHour } = useStore();
  if (!state || !meta) return null;
  const days = Array.from({ length: meta.days }, (_, i) => i);
  const comp = state.series.complaints;
  const cmax = meta.scales.complaints;
  const testsBy = new Map<number, { f: number; p: number }>();
  state.tests.forEach((x) => { const v = testsBy.get(x.day) ?? { f: 0, p: 0 }; if (x.failed) v.f++; else v.p++; testsBy.set(x.day, v); });
  const alertDay = state.escalation ? Math.round((new Date(state.escalation.opened).getTime() - new Date(meta.base_date).getTime()) / 864e5 - 0.5) : null;
  const ghost = alertDay !== null ? Math.min(meta.days - 1, alertDay + meta.headline.lead_days[0]) : null;
  return (
    <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.7 }}
      className="absolute left-4 right-4 bottom-4 z-20 glass rounded-2xl px-5 py-3 flex items-center gap-5">
      <button onClick={togglePlay} title="Play / pause (space)" className="w-12 h-12 rounded-full grid place-items-center bg-gradient-to-br from-aqua to-cyan text-abyss shadow-[0_0_24px_-6px_rgba(103,232,249,.8)] shrink-0">
        {playing ? <Pause size={19} /> : <Play size={19} className="ml-0.5" />}
      </button>
      <div className="flex-1">
        <div className="relative h-[48px]">
          <div className="absolute inset-x-0 bottom-3 flex items-end gap-[3px] h-8">
            {days.map((d) => (
              <button key={d} onClick={() => d >= 2 && setDay(d)} className="flex-1 h-full flex flex-col justify-end items-center">
                <motion.div className="w-full rounded-sm" style={{ background: d <= state.day ? "linear-gradient(0deg,#b4741a,#f5b544)" : "#173350" }}
                  initial={false} animate={{ height: `${Math.max(6, (100 * (comp[d] ?? 0)) / cmax)}%`, opacity: d <= state.day ? 1 : 0.45 }} />
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
          {alertDay !== null && (
            <div className="absolute top-0 h-full pointer-events-none" style={{ left: `${(100 * (alertDay + 0.5)) / meta.days}%` }}>
              <div className="w-px h-full bg-coral/80" /><div className="absolute -top-1.5 -translate-x-1/2 text-[10.5px] text-coral font-semibold whitespace-nowrap flex items-center gap-1"><AlertTriangle size={10} />JalKavach alert</div>
            </div>
          )}
          {ghost !== null && (
            <div className="absolute top-0 h-full pointer-events-none" style={{ left: `${(100 * (ghost + 0.5)) / meta.days}%` }}>
              <div className="w-px h-full border-l border-dashed border-white/40" /><div className="absolute -top-1.5 -translate-x-1/2 text-[10.5px] text-slate-400 whitespace-nowrap">hospital-only baseline ≈ (median, +{meta.headline.lead_days[0]} d)</div>
            </div>
          )}
          <motion.div className="absolute top-0 h-full pointer-events-none" initial={false} animate={{ left: `${(100 * (day + 0.5)) / meta.days}%` }} transition={{ type: "spring", stiffness: 200, damping: 25 }}>
            <div className="w-0.5 h-full bg-aqua shadow-[0_0_12px_#67e8f9]" />
          </motion.div>
        </div>
        <div className="flex justify-between text-[10px] text-mist mt-1 num">
          {days.filter((d) => d % 2 === 0).map((d) => <span key={d}>Day {d}</span>)}
        </div>
        <div className="text-[10px] text-mist/80 mt-0.5">bars = complaints / day · dots = field tests (red = below 0.2 mg/L)</div>
      </div>
      <div className="w-[170px] shrink-0">
        <div className="label">Hour {String(hour).padStart(2, "0")}:00</div>
        <div className="relative">
          <div className="absolute inset-x-0 top-[7px] h-1.5 flex pointer-events-none">
            {Array.from({ length: 24 }, (_, hh) => (
              <div key={hh} className="flex-1" style={{ background: meta.supply_windows.some(([a, b]) => hh >= a && hh < b) ? "rgba(103,232,249,.55)" : "transparent" }} />
            ))}
          </div>
          <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(+e.target.value)} className="relative w-full accent-cyan-400" />
        </div>
        <div className="text-[10.5px] text-mist">cyan = supply hours · ← → day · space play</div>
      </div>
    </motion.div>
  );
}

export function MapControls() {
  const { layers, toggleLayer, view, state, stage } = useStore();
  if (view !== "command" || !state || stage) return null;
  const items = [["flow", Waves, "Flow"], ["plume", Droplets, "Plume"], ["columns", BarChart3, "Odds"], ["buildings", Building2, "3D"]] as const;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
      className="absolute right-4 bottom-[132px] z-20 glass rounded-2xl p-1.5 flex gap-1">
      {items.map(([k, I, label]) => (
        <button key={k} onClick={() => toggleLayer(k)} className={clsx("flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] transition", layers[k] ? "bg-cyan/15 text-aqua" : "text-mist hover:bg-white/5")}>
          <I size={15} />{label}
        </button>
      ))}
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
  const t = useT();
  const overdue = !!state?.escalation && state.escalation.overdue_h > 0;
  return (
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }}
      className="absolute left-1/2 -translate-x-1/2 bottom-[132px] z-50 glass rounded-2xl p-1.5 flex gap-1 !bg-[#061422]/92">
      {NAV.map(({ v, label, I }, i) => (
        <button key={v} onClick={() => setView(v)} title={`${label} (${i + 1})`}
          className={clsx("relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-medium transition", view === v ? "text-abyss" : "text-slate-300 hover:bg-white/5")}>
          {view === v && <motion.span layoutId="dock" className="absolute inset-0 rounded-xl bg-gradient-to-r from-aqua to-cyan" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
          <I size={15} className="relative" /><span className="relative">{t(label)}</span>
          {v === "escalation" && overdue ? <span className="relative w-2 h-2 rounded-full bg-coral ping-soft" /> : null}
        </button>
      ))}
    </motion.div>
  );
}

export function Toast() {
  const { toast } = useStore();
  return (
    <AnimatePresence>
      {toast && Date.now() - toast.at < 4500 && (
        <motion.div key={toast.at} initial={{ y: -20, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -10 }}
          className={clsx("absolute top-[124px] left-1/2 -translate-x-1/2 z-[60] glass rounded-full px-5 py-2.5 text-[13.5px] font-medium !bg-[#061422]/95",
            toast.tone === "good" ? "text-mint" : toast.tone === "bad" ? "text-coral" : "text-aqua")}>
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AlertVignette() {
  const { alertAt, state } = useStore();
  return (
    <AnimatePresence>
      {alertAt > 0 && Date.now() - alertAt < 2600 && (
        <motion.div key={alertAt} className="absolute inset-0 z-[15] pointer-events-none"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.6, 0] }} transition={{ duration: 2.4, times: [0, 0.15, 0.5, 1] }}
          style={{ boxShadow: "inset 0 0 160px 30px rgba(255,107,107,.45)" }}>
          <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute top-[124px] left-1/2 -translate-x-1/2 glass rounded-full px-5 py-2.5 text-coral font-display font-semibold">
            Alert opened · {state?.escalation?.owner ?? "ward engineer"} notified
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Legend() {
  const { state, view, stage } = useStore();
  const t = useT();
  const [open, setOpen] = useState(() => window.innerHeight > 1000);
  if (!state || view !== "command" || stage) return null;
  const alerting = state.status === "ALERT";
  const items: [React.ReactNode, string][] = [
    [<span className="w-5 h-[3px] rounded bg-[#3478b4]" />, "Pipes: synthetic, laid on real OSM streets"],
    [<span className="w-5 h-[3px] rounded bg-gradient-to-r from-transparent to-aqua" />, "Water flow (supply hours only, simulated)"],
    [<span className="w-3 h-3 rounded-full bg-amber/70" />, "Low-pressure exposure (supply off)"],
    [<span className="w-3 h-3 rounded-full bg-amber" />, "Citizen complaints, last 3 days"],
    [<span className="flex gap-0.5"><span className="w-2.5 h-2.5 rounded-full bg-mint" /><span className="w-2.5 h-2.5 rounded-full bg-coral" /></span>, "Field test: passed / below 0.2 mg/L"],
    [<span className="w-3 h-3 rounded-full bg-violet-400" />, "Partner medical store (aggregate counts)"],
    [<span className="w-3 h-3 rounded-sm bg-[#1a2e46]" />, "Buildings: OSM footprints, heights illustrative"],
  ];
  if (alerting) {
    items.push([<span className="w-2.5 h-4 rounded-sm bg-gradient-to-t from-amber to-coral" />, "Column height = probability (absolute)"]);
    items.push([<span className="w-3 h-3 rounded-full bg-coral/50" />, `Plume: predicted spread if #1 is the source (p = ${(100 * state.plume.p).toFixed(0)}%)`]);
    items.push([<span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400" />, "Suggested test tap"]);
  }
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}
      className="absolute left-4 bottom-[132px] z-20 glass rounded-2xl px-3.5 py-2.5 w-[250px]">
      <button onClick={() => setOpen((o) => !o)} className="label w-full text-left flex justify-between items-center">{t("Map legend")}<span className="text-mist">{open ? "–" : "+"}</span></button>
      {open && <div className="space-y-1.5 mt-2">
        {items.map(([sw, x], i) => (
          <div key={i} className="flex items-center gap-2.5 text-[11.5px] text-slate-300 leading-tight"><span className="w-6 flex justify-center shrink-0">{sw}</span>{x}</div>
        ))}
      </div>}
    </motion.div>
  );
}
