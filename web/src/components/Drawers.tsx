import type React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import WaveSurfer from "wavesurfer.js";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Beaker, Camera, Check, CheckCircle2, ChevronRight, FileText, Link2, Lock, MapPin, Mic, Pause, Play, Send,
  ShieldAlert, ShieldCheck, Sparkles, Stamp, Upload, X, XCircle, Languages,
} from "lucide-react";
import { api, type AuditRow, type Clip, type KitResult, type Parsed } from "../api";
import { useStore } from "../store";
import { pct } from "../fmt";

export function Shell({ title, icon, children, wide = false }: { title: string; icon: React.ReactElement; children: React.ReactNode; wide?: boolean }) {
  const { setView } = useStore();
  return (
    <motion.div initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className={clsx("absolute right-4 top-[132px] bottom-[164px] z-40 glass rounded-3xl flex flex-col overflow-hidden", wide ? "left-[290px] !bg-[#061422]/95" : "w-[620px] !bg-[#061422]/90")}>
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl grid place-items-center bg-cyan/15 text-aqua">{icon}</div>
        <div className="font-display text-xl font-semibold">{title}</div>
        <div className="flex-1" />
        <button onClick={() => setView("command")} className="w-9 h-9 rounded-xl grid place-items-center hover:bg-white/5 text-mist"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin px-6 py-5">{children}</div>
    </motion.div>
  );
}

function Typewriter({ text, speed = 22 }: { text: string; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => { setN(0); const id = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(id), x) : x + 1)), speed); return () => clearInterval(id); }, [text]);
  return <span>{text.slice(0, n)}<span className="inline-block w-[2px] h-[1em] bg-aqua align-[-2px] ml-0.5 animate-pulse" /></span>;
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "amber" | "coral" | "violet" | "aqua" | "mist" }) {
  const m = { amber: "bg-amber/15 text-amber", coral: "bg-coral/15 text-coral", violet: "bg-violet-400/15 text-violet-300", aqua: "bg-cyan/15 text-aqua", mist: "bg-white/5 text-mist" };
  return <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={clsx("px-2.5 py-1 rounded-full text-[12px] font-medium", m[tone])}>{children}</motion.span>;
}

/* ------------------------------------------------------------------ intake */
export function Intake() {
  const { day, hour, refresh, setFocus, notify, state } = useStore();
  const [tab, setTab] = useState<"voice" | "kit">(new URLSearchParams(window.location.search).get("tab") === "kit" ? "kit" : "voice");
  const [clips, setClips] = useState<Clip[]>([]);
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState<"idle" | "transcribing" | "parsed">("idle");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [free, setFree] = useState("");
  const [playing, setPlaying] = useState(false);
  const waveRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);

  useEffect(() => { api.clips().then(setClips); }, []);
  useEffect(() => {
    if (!waveRef.current || !clips[sel]) return;
    ws.current?.destroy();
    ws.current = WaveSurfer.create({ container: waveRef.current, height: 56, waveColor: "#1f4a73", progressColor: "#67e8f9", cursorColor: "#ff6b6b", barWidth: 3, barGap: 2, barRadius: 3, url: `/api/clips/${clips[sel].id}.wav` });
    ws.current.on("finish", () => setPlaying(false));
    setPhase("idle"); setParsed(null);
    return () => ws.current?.destroy();
  }, [clips, sel]);

  const clip = clips[sel];
  const transcribe = async () => {
    if (!clip) return;
    setPhase("transcribing");
    const text = clip.transcript ?? clip.text;
    const r = await api.parse(text);
    setTimeout(() => { setParsed(r.parsed); setPhase("parsed"); }, 1100);
  };
  const parseFree = async () => { if (!free.trim()) return; const r = await api.parse(free); setParsed(r.parsed); setPhase("parsed"); };
  const pin = () => parsed?.lat && setFocus({ lon: parsed.lon!, lat: parsed.lat!, label: parsed.label ?? "", kind: "complaint", at: Date.now() });
  const add = async () => {
    if (!parsed) return;
    const before = state?.alert_index ?? 0;
    const r = await api.addComplaint(parsed.text, day, hour);
    if (!r.added) { notify(`Not added: ${r.reason}`, "bad"); return; }
    pin(); await refresh();
    const after = useStore.getState().state?.alert_index ?? 0;
    notify(`Complaint added at ${r.parsed.label} · alert index ${before.toFixed(0)} → ${after.toFixed(0)}`, "good");
  };

  return (
    <Shell title="Complaint & field-test intake" icon={<Mic size={18} />}>
      <div className="flex gap-2 mb-5">
        {([["voice", "Citizen voice note", Mic], ["kit", "Field-test photo", Camera]] as const).map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx("relative px-4 py-2 rounded-xl text-[13px] flex items-center gap-2", tab === k ? "text-abyss" : "text-slate-300 bg-white/5")}>
            {tab === k && <motion.span layoutId="itab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-aqua to-cyan" />}
            <I size={15} className="relative" /><span className="relative">{l}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {tab === "voice" ? (
          <motion.div key="v" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {clips.map((c, i) => (
                <button key={c.id} onClick={() => setSel(i)} className={clsx("px-3 py-1.5 rounded-full text-[12px] border transition", i === sel ? "border-aqua text-aqua bg-cyan/10" : "border-white/10 text-mist hover:text-white")}>
                  Voice note {i + 1}
                </button>
              ))}
            </div>
            <div className="rounded-2xl bg-black/25 border border-white/5 p-4">
              <div className="flex items-center gap-3">
                <button onClick={() => { ws.current?.playPause(); setPlaying((p) => !p); }} className="w-11 h-11 rounded-full grid place-items-center bg-amber text-abyss shrink-0">
                  {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                </button>
                <div ref={waveRef} className="flex-1" />
              </div>
              {clip && <div className="text-[12px] text-mist mt-2">English: {clip.en}</div>}
              <div className="text-[10.5px] text-mist/70 mt-1">Demo voice is synthetic (TTS). Speech recognition runs locally with faster-whisper; no audio leaves the machine.</div>
            </div>
            <button onClick={transcribe} disabled={phase === "transcribing"} className="w-full rounded-xl py-3 font-display font-semibold bg-gradient-to-r from-aqua to-cyan text-abyss flex items-center justify-center gap-2 disabled:opacity-60">
              <Sparkles size={16} />{phase === "transcribing" ? "Transcribing locally…" : "Transcribe & understand"}
            </button>
            <div className="flex gap-2">
              <input value={free} onChange={(e) => setFree(e.target.value)} placeholder="…or type a complaint in Hindi, Hinglish or English" className="flex-1 bg-black/25 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-aqua" />
              <button onClick={parseFree} className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-[13px]">Parse</button>
            </div>
            <AnimatePresence>
              {phase === "transcribing" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-1.5 items-end h-10 px-2">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <motion.span key={i} className="w-1.5 rounded-full bg-aqua/70" animate={{ height: [6, 30, 10, 24, 6] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.04 }} />
                  ))}
                </motion.div>
              )}
              {phase === "parsed" && parsed && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/8 bg-black/20 p-4 space-y-3">
                  <div className="label">Transcript</div>
                  <div className="font-hindi text-[16px] leading-relaxed text-white"><Typewriter text={parsed.text} /></div>
                  <div className="label pt-1">Understood</div>
                  <div className="flex flex-wrap gap-2">
                    {parsed.colour.map((c) => <Chip key={c} tone="amber">colour: {c}</Chip>)}
                    {parsed.odour.map((c) => <Chip key={c} tone="coral">odour: {c}</Chip>)}
                    {parsed.symptoms.map((c) => <Chip key={c} tone="violet">symptom: {c}</Chip>)}
                    {!parsed.water_quality && <Chip tone="mist">not a water-quality complaint</Chip>}
                  </div>
                  <div className="flex items-center gap-2 text-[13px]">
                    <MapPin size={15} className={parsed.node !== null ? "text-aqua" : "text-mist"} />
                    {parsed.node !== null ? (
                      <span>Heard <b className="font-hindi">"{parsed.place_text}"</b> → <b className="text-aqua">{parsed.place_match}</b> ({parsed.match_score.toFixed(0)}% match) → {parsed.label} · ±{parsed.radius_m} m</span>
                    ) : <span className="text-mist">No known landmark heard. Not geocoded.</span>}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={pin} disabled={parsed.node === null} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[13px] flex items-center gap-2 disabled:opacity-40"><MapPin size={14} />Show on map</button>
                    <button onClick={add} disabled={parsed.node === null || !parsed.water_quality} className="flex-1 px-4 py-2 rounded-xl bg-amber text-abyss font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-40"><Send size={14} />Add to evidence (day {day})</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <KitPanel key="k" />
        )}
      </AnimatePresence>
    </Shell>
  );
}

function KitPanel() {
  const { state, net, day, hour, refresh, setFocus, notify } = useStore();
  const [res, setRes] = useState<KitResult | null>(null);
  const [scan, setScan] = useState(false);
  const [node, setNode] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.suggested[0] && node === null) setNode(state.suggested[0].node); }, [state]);
  const run = async (p: Promise<KitResult>) => { setRes(null); setScan(true); const r = await p; setRes(r); setTimeout(() => setScan(false), 1700); };
  const scale = res?.scale ?? [];
  const grad = scale.map((s) => `rgb(${s.rgb.join(",")}) ${(100 * s.mg) / 1}%`).join(",");
  const add = async () => {
    if (!res?.ok || node === null || !net) return;
    await api.addTest(node, day, hour, !!res.below, res.value);
    setFocus({ lon: net.nodes[node].lon, lat: net.nodes[node].lat, label: net.nodes[node].label, kind: "test", at: Date.now() });
    await refresh();
    notify(`Field test recorded at ${net.nodes[node].label}`, "good");
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => run(api.kitDemo(day))} className="flex-1 rounded-xl py-3 font-semibold bg-gradient-to-r from-aqua to-cyan text-abyss flex items-center justify-center gap-2"><Camera size={16} />Capture demo sample</button>
        <button onClick={() => file.current?.click()} className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-[13px] flex items-center gap-2"><Upload size={15} />Upload photo</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && run(api.kitUpload(e.target.files[0]))} />
      </div>
      <div className="text-[11px] text-mist">Demo sample is labelled "dechlorinated" and is rendered synthetically. The reader is validated on synthetic photos only; lab validation is pending.</div>
      {!res && !scan && (
        <div className="grid grid-cols-5 gap-4 items-center">
          <img src="/field_card.png" className="col-span-3 rounded-2xl border border-white/10" />
          <div className="col-span-2 text-[12.5px] text-slate-300 space-y-2">
            <div className="label">The JalKavach field card</div>
            <p>Four corner markers let any phone photo be squared up. The white patch fixes the lighting. The printed scale (copied from the kit's own comparator) sits under the same light as the sample, so colour casts cancel.</p>
            <p className="text-mist">Print it, place the tube in the window, take a photo. Works on any phone camera.</p>
          </div>
        </div>
      )}
      {res && (
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3 relative rounded-2xl overflow-hidden border border-white/10 bg-black">
            <img src={res.photo} className="w-full block" />
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              {res.markers.map((m, i) => (
                <motion.polygon key={m.id} points={m.pts.map((p) => p.join(",")).join(" ")} fill="rgba(103,232,249,.18)" stroke="#67e8f9" strokeWidth="0.004"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.2 }} />
              ))}
            </svg>
            {scan && <motion.div className="absolute left-0 right-0 h-1 bg-aqua shadow-[0_0_20px_6px_rgba(103,232,249,.6)]" animate={{ top: ["0%", "100%", "0%"] }} transition={{ duration: 1.6, ease: "easeInOut" }} />}
            <div className="absolute top-2 left-2 text-[10.5px] px-2 py-1 rounded-full bg-black/60 text-aqua">{res.markers.length}/4 corner markers found</div>
          </div>
          <div className="col-span-2 space-y-3">
            {res.rectified && <motion.img initial={{ opacity: 0, rotateX: 40 }} animate={{ opacity: 1, rotateX: 0 }} transition={{ delay: 0.9 }} src={res.rectified} className="rounded-xl border border-white/10" />}
            <AnimatePresence>
              {!scan && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <div className="label">Free chlorine (screening)</div>
                  <div className="relative h-5 rounded-full" style={{ background: `linear-gradient(90deg, ${grad})` }}>
                    <div className="absolute -top-1 bottom-[-4px] w-px bg-white" style={{ left: "20%" }} />
                    <div className="absolute -bottom-4 text-[9.5px] text-mist -translate-x-1/2" style={{ left: "20%" }}>0.2 IS 10500</div>
                    {res.value !== null && (
                      <motion.div className="absolute -top-2 w-3 h-9 rounded-sm border-2 border-white shadow-lg" style={{ background: "rgba(255,255,255,.1)" }}
                        initial={{ left: "0%" }} animate={{ left: `calc(${Math.min(100, 100 * res.value)}% - 6px)` }} transition={{ type: "spring", stiffness: 120, damping: 14 }} />
                    )}
                  </div>
                  <div className={clsx("mt-6 rounded-xl px-3 py-2.5 text-[13px] font-medium flex items-start gap-2", res.below ? "bg-coral/15 text-coral" : "bg-mint/15 text-mint")}>
                    {res.below ? <XCircle size={17} className="shrink-0 mt-px" /> : <CheckCircle2 size={17} className="shrink-0 mt-px" />}
                    <span>{res.ok ? `≈${res.value?.toFixed(2)} mg/L: ${res.below ? "below" : "at/above"} 0.2 mg/L` : res.message}</span>
                  </div>
                  <div className="label">Tap where sampled</div>
                  <select value={node ?? ""} onChange={(e) => setNode(+e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-[12.5px]">
                    {net?.nodes.map((n) => <option key={n.i} value={n.i}>{state?.suggested.some((s) => s.node === n.i) ? "★ " : ""}{n.label}</option>)}
                  </select>
                  <button onClick={add} disabled={!res.ok} className="w-full rounded-xl py-2.5 bg-amber text-abyss font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-40"><Beaker size={15} />Add field test (day {day})</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* --------------------------------------------------------------- escalation */
function Radial({ frac, color, size = 64, children }: { frac: number; color: string; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#14304c" strokeWidth="5" fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c}
          initial={false} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, frac))) }} transition={{ duration: 0.9 }} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Escalation() {
  const { state, meta, day, hour, refresh, notify, setDay } = useStore();
  const [actor, setActor] = useState(0);
  const [lang, setLang] = useState<"hi" | "en">("hi");
  const [stamped, setStamped] = useState<Record<string, boolean>>({});
  const esc = state?.escalation;
  if (!meta) return null;
  const stages = meta.policy.stages;
  const act = async (a: string) => {
    const r = await api.action(a, stages[Math.min(actor, stages.length - 1)].owner, day, hour);
    if (!r.ok) notify(r.error ?? "not allowed", "bad"); else { notify(`Recorded: ${a.replace("_", " ")}`, "good"); await refresh(); }
    if (a.startsWith("approve")) setStamped((s) => ({ ...s, [a]: true }));
  };
  const adv = esc?.advisory?.split("\n") ?? [];
  const hi = adv.slice(0, 2).join("\n"), en = adv.slice(2).join("\n");
  return (
    <Shell title="Alert & the city's escalation clock" icon={<ShieldAlert size={18} />}>
      {!esc ? (
        <div className="text-mist text-[14px] space-y-4">
          <p>No alert yet. Move the timeline forward (press play) and the alert opens automatically when the evidence crosses the calibrated threshold.</p>
          <button onClick={() => setDay(meta.alarm_day + 1)} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[13px] text-aqua">Jump to day {meta.alarm_day + 1}</button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="font-display text-2xl font-bold">Alert {esc.id}</div>
            <span className={clsx("px-3 py-1 rounded-full text-[12px] font-semibold", esc.status === "open" ? "bg-coral/15 text-coral" : esc.status === "confirmed" ? "bg-amber/15 text-amber" : "bg-mint/15 text-mint")}>{esc.status}</span>
            <div className="text-[12px] text-mist">opened {new Date(esc.opened).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · DSO (IDSP) notified</div>
          </div>
          <div className="text-[12px] text-mist -mt-3">The city sets every owner, SLA and escalation step (configs/escalation.yaml). JalKavach runs the clock and keeps the record.</div>
          <div className="grid grid-cols-3 gap-3">
            {stages.map((s, k) => {
              const done = k < esc.stage_index || esc.status !== "open";
              const cur = k === esc.stage_index && esc.status === "open";
              const frac = cur ? (esc.overdue_h > 0 ? 1 : 1 - esc.remaining_h / s.sla_hours) : done ? 1 : 0;
              const col = done ? "#34d399" : cur ? (esc.overdue_h > 0 ? "#ff6b6b" : "#67e8f9") : "#2b4a69";
              return (
                <motion.div key={s.id} layout className={clsx("rounded-2xl p-4 border", cur ? "border-aqua/40 bg-cyan/5" : "border-white/5 bg-black/15")}>
                  <Radial frac={frac} color={col}>
                    {done ? <Check size={20} className="text-mint" /> : <span className="font-display text-[13px] num" style={{ color: col }}>{cur ? (esc.overdue_h > 0 ? `+${esc.overdue_h.toFixed(0)}h` : `${esc.remaining_h.toFixed(0)}h`) : `${s.sla_hours}h`}</span>}
                  </Radial>
                  <div className="mt-3 font-semibold text-[14px]">{s.label}</div>
                  <div className="text-[11.5px] text-mist">{s.owner}</div>
                  <div className="text-[11px] text-mist/80 mt-1">SLA {s.sla_hours} h</div>
                </motion.div>
              );
            })}
          </div>
          <div>
            <div className="label mb-2">Escalation chain (notified when a stage is overdue)</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {meta.policy.chain.map((c, i) => {
                const lit = esc.escalated_to.includes(c);
                return (
                  <div key={c} className="flex items-center gap-1.5">
                    <motion.div animate={lit ? { boxShadow: ["0 0 0px #ff6b6b", "0 0 18px #ff6b6b", "0 0 0px #ff6b6b"] } : {}} transition={{ duration: 1.6, repeat: Infinity }}
                      className={clsx("px-3 py-1.5 rounded-xl text-[12px] border", lit ? "border-coral/60 text-coral bg-coral/10" : "border-white/10 text-mist")}>{c}</motion.div>
                    {i < meta.policy.chain.length - 1 && <ChevronRight size={14} className={lit ? "text-coral" : "text-white/20"} />}
                  </div>
                );
              })}
            </div>
          </div>
          {esc.status === "open" && (
            <div className="rounded-2xl bg-black/20 border border-white/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-[12.5px]"><span className="text-mist">Acting as</span>
                <select value={actor} onChange={(e) => setActor(+e.target.value)} className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5">
                  {stages.map((s, i) => <option key={s.id} value={i}>{s.owner}</option>)}
                </select>
              </div>
              <div className="flex gap-2 flex-wrap">
                {esc.stage_index === 0 && <button onClick={() => act("acknowledge")} className="px-4 py-2 rounded-xl bg-gradient-to-r from-aqua to-cyan text-abyss font-semibold text-[13px]">Acknowledge</button>}
                {esc.stage_index === 1 && <button onClick={() => act("samples")} className="px-4 py-2 rounded-xl bg-gradient-to-r from-aqua to-cyan text-abyss font-semibold text-[13px]">Field tests taken</button>}
                {esc.stage_index === 2 && <>
                  <button onClick={() => act("confirm")} className="px-4 py-2 rounded-xl bg-coral text-abyss font-semibold text-[13px]">Confirm ingress → create drafts</button>
                  <button onClick={() => act("clear")} className="px-4 py-2 rounded-xl bg-white/5 text-[13px]">Clear (false alarm)</button>
                </>}
              </div>
            </div>
          )}
          {esc.work_order && (
            <div className="grid grid-cols-2 gap-4">
              <div className="relative rounded-2xl bg-black/25 border border-white/8 p-4">
                <div className="label mb-2 flex items-center gap-1.5"><FileText size={12} />Draft work order</div>
                <pre className="text-[11.5px] whitespace-pre-wrap text-slate-200 font-mono leading-relaxed">{esc.work_order}</pre>
                <button onClick={() => act("approve_work_order")} className="mt-3 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px]">Approve (Executive Engineer)</button>
                <AnimatePresence>{stamped.approve_work_order && <Stampy />}</AnimatePresence>
              </div>
              <div className="relative rounded-2xl bg-black/25 border border-white/8 p-4">
                <div className="flex items-center justify-between mb-2"><div className="label flex items-center gap-1.5"><Languages size={12} />Draft boil-water advisory</div>
                  <div className="flex text-[11px] rounded-lg overflow-hidden border border-white/10">
                    {(["hi", "en"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={clsx("px-2 py-0.5", lang === l ? "bg-cyan/20 text-aqua" : "text-mist")}>{l === "hi" ? "हिंदी" : "EN"}</button>)}
                  </div></div>
                <div className={clsx("text-[13px] whitespace-pre-wrap leading-relaxed text-slate-100", lang === "hi" && "font-hindi")}>{lang === "hi" ? hi : en}</div>
                <button onClick={() => act("approve_advisory")} className="mt-3 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px]">Approve ({meta.policy.advisory_approver})</button>
                <AnimatePresence>{stamped.approve_advisory && <Stampy />}</AnimatePresence>
              </div>
              <div className="col-span-2 text-[11.5px] text-mist flex items-center gap-2"><Lock size={13} />JalKavach never sends anything. The approval is recorded, and the officer sends through official channels.</div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function Stampy() {
  return (
    <motion.div initial={{ scale: 2.4, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -10 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}
      className="absolute top-6 right-6 px-3 py-1.5 rounded-lg border-2 border-mint text-mint font-display font-bold tracking-widest text-sm flex items-center gap-1.5 bg-abyss/70">
      <Stamp size={15} />APPROVED
    </motion.div>
  );
}

/* -------------------------------------------------------------------- audit */
export function Audit() {
  const { state } = useStore();
  const [data, setData] = useState<{ ok: boolean; bad: number | null; rows: AuditRow[] } | null>(null);
  const [verify, setVerify] = useState(-1);
  const [broken, setBroken] = useState<number | null>(null);
  useEffect(() => { api.audit().then(setData); setBroken(null); }, [state]);
  const runVerify = () => { setBroken(null); setVerify(0); const n = data?.rows.length ?? 0; let i = 0; const id = setInterval(() => { i++; setVerify(i); if (i > n) clearInterval(id); }, 220); };
  const tamper = async () => { const r = await api.tamper(); setVerify(-1); setBroken(r.broken_at); };
  const actionName = (a: string) => a.replace("stage_done:", "done: ").replace("_", " ");
  return (
    <Shell title="Tamper-evident audit trail" icon={<Link2 size={18} />} wide>
      <div className="flex items-center gap-3 mb-5">
        <div className={clsx("px-3 py-1.5 rounded-full text-[12.5px] font-semibold flex items-center gap-2", data?.ok ? "bg-mint/15 text-mint" : "bg-coral/15 text-coral")}>
          {data?.ok ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}Hash chain {data?.ok ? "intact" : "broken"} · {data?.rows.length ?? 0} entries
        </div>
        <button onClick={runVerify} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px]">Verify chain</button>
        <button onClick={tamper} className="px-4 py-2 rounded-xl bg-coral/15 text-coral hover:bg-coral/25 text-[12.5px]">Tamper test: edit entry 1 in a copy</button>
        <div className="text-[11.5px] text-mist">Every action, by whom and when. Proof that the engineer who acted, acted on time.</div>
      </div>
      {!data?.rows.length ? <div className="text-mist text-[13px]">No entries yet. Move the timeline to the alert.</div> : (
        <div className="flex items-stretch gap-0 overflow-x-auto pb-4 scrollbar-thin">
          {data.rows.map((r, i) => {
            const isBroken = broken !== null && r.seq >= broken;
            const verified = verify > i;
            return (
              <div key={r.seq} className="flex items-center">
                <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, x: isBroken && r.seq === broken ? [0, -6, 6, -4, 4, 0] : 0 }} transition={{ delay: i * 0.05 }}
                  className={clsx("w-[210px] shrink-0 rounded-2xl p-3.5 border transition-colors", isBroken ? "border-coral/60 bg-coral/10" : verified ? "border-mint/50 bg-mint/5" : "border-white/8 bg-black/20")}>
                  <div className="flex items-center justify-between"><span className="font-display text-[13px] text-mist">#{r.seq}</span><span className="text-[10.5px] text-mist num">{r.ts.replace("T", " ")}</span></div>
                  <div className="mt-1.5 font-semibold text-[13px] capitalize">{actionName(r.action)}</div>
                  <div className="text-[11.5px] text-mist truncate">{r.actor}</div>
                  <div className="mt-2 font-mono text-[10.5px] text-aqua/80 truncate">{r.hash.slice(0, 18)}…</div>
                  <div className="font-mono text-[10px] text-mist/60 truncate">prev {r.prev_hash.slice(0, 12)}…</div>
                </motion.div>
                {i < data.rows.length - 1 && (
                  <div className="w-8 flex items-center"><div className={clsx("h-0.5 w-full", isBroken && r.seq >= (broken ?? 0) ? "bg-coral" : verified ? "bg-mint" : "bg-white/15")} /></div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {broken !== null && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-2xl border border-coral/40 bg-coral/10 p-4 text-[13px] text-coral">
          One character was changed in entry #{broken} of a copy. Its hash no longer matches, so every later link breaks. Any edit after the fact is detectable.
        </motion.div>
      )}
    </Shell>
  );
}

/* ----------------------------------------------------------------- evidence */
export function Evidence() {
  const { meta } = useStore();
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.results>> | null>(null);
  useEffect(() => { api.results().then(setRes); }, []);
  if (!meta) return null;
  const h = meta.headline;
  const names: Record<string, [string, string]> = { F: ["JalKavach (fusion)", "#67e8f9"], C: ["Complaints only", "#f5b544"], S: ["Pharmacy only", "#a78bfa"], T: ["Field tests only", "#34d399"], CC: ["Complaint-count alarm", "#94a3b8"], H: ["Hospital admissions (baseline)", "#ff6b6b"] };
  const cdf = res ? Array.from({ length: 15 }, (_, x) => ({ x, ...Object.fromEntries(Object.entries(res.cdf).map(([k, v]) => [k, Math.round(100 * v[x])])) })) : [];
  const s = res?.summary;
  return (
    <Shell title="Evidence: held-out, simulated, pre-registered" icon={<Sparkles size={18} />} wide>
      <div className="grid grid-cols-4 gap-3">
        {[
          [`${h.lead_days[0]} days`, `median lead over hospital-only baseline (95% CI ${h.lead_days[1]}–${h.lead_days[2]})`],
          [pct(h.detected_F), `events detected in 21 days, vs ${pct(h.detected_H)} for the hospital baseline`],
          [pct(h.top3_F), `true pipe in the top 3 three days after the alert, vs ${pct(h.top3_CC)} by complaint centroid`],
          [pct(h.coverage), "of 90% credible sets contain the true pipe (calibrated)"],
        ].map(([v, l], i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-2xl bg-black/20 border border-white/5 p-4">
            <div className="font-display text-4xl font-bold bg-gradient-to-r from-aqua to-cyan bg-clip-text text-transparent">{v}</div>
            <div className="text-[12px] text-mist mt-1.5 leading-snug">{l}</div>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-4 mt-5">
        <div className="col-span-3 rounded-2xl bg-black/20 border border-white/5 p-4">
          <div className="label mb-1">Share of events detected, by days after onset (≤1 false alarm / ward / quarter)</div>
          <div className="h-[290px]">
            <ResponsiveContainer>
              <LineChart data={cdf} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#14304c" strokeDasharray="3 3" />
                <XAxis dataKey="x" stroke="#8fb3d1" fontSize={11} tickFormatter={(x) => `${x}d`} />
                <YAxis stroke="#8fb3d1" fontSize={11} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "#061422", border: "1px solid #15304b", borderRadius: 10, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.keys(names).filter((k) => res?.cdf[k]).map((k) => (
                  <Line key={k} type="monotone" dataKey={k} name={names[k][0]} stroke={names[k][1]} strokeWidth={k === "F" || k === "H" ? 3 : 1.6} dot={false} isAnimationActive={!new URLSearchParams(window.location.search).has("shot")} animationDuration={1600} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="col-span-2 space-y-3">
          <div className="rounded-2xl bg-black/20 border border-white/5 p-4">
            <div className="label mb-2">How it was tested</div>
            <ul className="text-[12.5px] text-slate-300 space-y-1.5 list-disc ml-4">
              <li>Metrics and thresholds pre-registered before the first run</li>
              <li>1,120 held-out scenarios on fresh seeds + 400 on EPANET Net3</li>
              <li>10 perturbed networks; a complaint process the engine does not assume</li>
              <li>Truth from a different risk model than the engine's prior</li>
              <li>Baselines: hospital-admission and complaint-count EARS, complaint centroid</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-amber/30 bg-amber/5 p-4">
            <div className="label mb-2 text-amber">What did not work as well (reported as measured)</div>
            <ul className="text-[12.5px] text-amber/90 space-y-1.5 list-disc ml-4">
              <li>Fusion doesn't alarm <i>earlier</i> than complaints alone. It catches <i>more</i> events and names <i>where</i>.</li>
              <li>The intermittent-supply prior vs a 24×7 prior: +2.7 pts, not significant.</li>
              <li>Info-gain test routing ≈ random (7.8 vs 9.2 tests); CIs overlap.</li>
              <li>Lower detection where people report less (89% vs 96–98%).</li>
              <li>All results are simulated, not field data.</li>
            </ul>
          </div>
        </div>
      </div>
      {s && (
        <div className="mt-4 text-[11.5px] text-mist">Robustness topology (EPANET Net3): lead {res!.net3.lead_F_vs_H[0]} days [{res!.net3.lead_F_vs_H[1]}–{res!.net3.lead_F_vs_H[2]}]. Full tables in results/RESULTS.md.</div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------- vision */
export function Vision() {
  const steps = [
    { k: "1 ward", t: "Pilot", d: "One Indore ward. CSR-funded, no procurement. Real network map and complaint log replace the synthetic layers.", n: "₹12 L onboarding" },
    { k: "85 wards", t: "Indore", d: "The city's own clock across every ward, on the 150–200 km of new AMRUT pipe being laid.", n: "≈ ₹1.3–1.7 cr / yr" },
    { k: "Simhastha 2028", t: "Ujjain", d: "Temporary networks for crores of pilgrims. When Ujjain hosts Simhastha 2028, it's ready.", n: "mela-grid template" },
    { k: "~400 ULBs", t: "Madhya Pradesh", d: "Digitise the field tests the state's Amrut Mitras already run (80,000+ so far).", n: "state rate contract" },
    { k: "AMRUT cities", t: "India 2036", d: "Tap-water safety as visible to a city as its air quality index. Open engine, built to the Digital Public Goods standard.", n: "open core + managed service" },
  ];
  return (
    <Shell title="2036: from one ward to every tap" icon={<Sparkles size={18} />} wide>
      <div className="relative">
        <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-aqua via-cyan to-azure opacity-50" />
        {steps.map((s, i) => (
          <motion.div key={s.k} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i }} className="relative flex gap-5 mb-5">
            <motion.div className="w-14 h-14 rounded-2xl grid place-items-center font-display font-bold text-abyss shrink-0 z-10"
              style={{ background: `linear-gradient(135deg, #67e8f9, ${["#22a6f2", "#2b8cf0", "#3a6ff0", "#2f5be8", "#2546e8"][i]})` }}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15 * i + 0.1, type: "spring" }}>{i + 1}</motion.div>
            <div className="flex-1 rounded-2xl bg-black/20 border border-white/5 p-4">
              <div className="flex items-baseline gap-3"><div className="font-display text-xl font-semibold">{s.t}</div><div className="text-aqua text-[13px]">{s.k}</div><div className="flex-1" /><div className="text-[12px] text-mist">{s.n}</div></div>
              <div className="text-[13px] text-slate-300 mt-1">{s.d}</div>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-2 rounded-2xl border border-cyan/30 bg-cyan/5 p-5">
        <div className="label text-aqua">Message for the 2036 Capsule</div>
        <div className="font-display text-lg mt-2 text-slate-100">"Dear 2036: we built this so that no Indian city ever again learns its water is contaminated from a hospital bed. If you're drinking from a tap without a second thought, it worked."</div>
      </motion.div>
    </Shell>
  );
}
