import type React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import WaveSurfer from "wavesurfer.js";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from "recharts";
import {
  Beaker, Camera, Check, CheckCircle2, FileText, Link2, Lock, MapPin, Mic, Pause, Play, Send,
  ShieldAlert, ShieldCheck, Sparkles, Stamp, Upload, X, XCircle, Languages, Square, Printer, UserRound, Hash,
} from "lucide-react";
import { api, type ASR, type AuditRow, type Clip, type KitResult, type Parsed } from "../api";
import { useStore } from "../store";
import { pct } from "../fmt";
import { useL, useT } from "../i18n";

const SHOT = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("shot");

export function Shell({ title, icon, children, wide = false }: { title: string; icon: React.ReactElement; children: React.ReactNode; wide?: boolean }) {
  const { setView } = useStore();
  const t = useT();
  return (
    <motion.div role="dialog" aria-label={t(title)} initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className={clsx("absolute right-4 top-[124px] bottom-[190px] z-40 glass rounded-3xl flex flex-col overflow-hidden", wide ? "left-[280px] !bg-[#061422]/95" : "w-[640px] !bg-[#061422]/92")}>
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl grid place-items-center bg-cyan/15 text-aqua">{icon}</div>
        <div className="font-display text-xl font-semibold">{t(title)}</div>
        <div className="flex-1" />
        <button aria-label="Close (Esc)" onClick={() => setView("command")} className="w-9 h-9 rounded-xl grid place-items-center hover:bg-white/5 text-mist"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin px-6 pt-5 pb-9 [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">{children}</div>
    </motion.div>
  );
}

function Typewriter({ text, speed = 28 }: { text: string; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => { setN(0); const id = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(id), x) : x + 1)), speed); return () => clearInterval(id); }, [text]);
  return <span>{text.slice(0, n)}{n < text.length && <span className="inline-block w-[2px] h-[1em] bg-aqua align-[-2px] ml-0.5 animate-pulse" />}</span>;
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "amber" | "coral" | "violet" | "aqua" | "mist" }) {
  const m = { amber: "bg-amber/15 text-amber", coral: "bg-coral/15 text-coral", violet: "bg-violet-400/15 text-violet-300", aqua: "bg-cyan/15 text-aqua", mist: "bg-white/5 text-mist" };
  return <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={clsx("px-2.5 py-1 rounded-full text-[12.5px] font-medium", m[tone])}>{children}</motion.span>;
}

/* ------------------------------------------------------------------ intake */
export function Intake() {
  const { day, hour, refresh, setFocus, notify } = useStore();
  const t = useT();
  const [asrState, setAsrState] = useState<{ state: string; label: string } | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [tab, setTab] = useState<"voice" | "kit">(new URLSearchParams(window.location.search).get("tab") === "kit" ? "kit" : "voice");
  const [clips, setClips] = useState<Clip[]>([]);
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [asr, setAsr] = useState<ASR | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [english, setEnglish] = useState<string | null>(null);
  const [free, setFree] = useState("");
  const [playing, setPlaying] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [delta, setDelta] = useState<{ label: string; a: number; b: number } | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null); // the result (and the "which one?" picker) is scrolled into view
  const ws = useRef<WaveSurfer | null>(null);

  useEffect(() => { api.clips().then(setClips); }, []);
  // deep link for walkthroughs and screenshots: /?view=intake&parse=<text> opens with that text understood
  const deep = useRef(new URLSearchParams(window.location.search).get("parse"));
  useEffect(() => {
    const q = deep.current;
    if (!q || !clips.length) return; // after the clip list loads (selecting a clip resets the result)
    deep.current = null;
    const id = window.setTimeout(() => api.parse(q).then((r) => { setParsed(r.parsed); setFree(q); setPhase("done"); }), 300);
    return () => window.clearTimeout(id);
  }, [clips]);
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const s = await api.asrStatus(); if (!alive) return; setAsrState(s); if (s.state === "warming") setTimeout(poll, 4000); } catch { /* server busy */ } };
    poll();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!waveRef.current || !clips[sel]) return;
    ws.current?.destroy();
    ws.current = WaveSurfer.create({ container: waveRef.current, height: 56, waveColor: "#1f4a73", progressColor: "#67e8f9", cursorColor: "#ff6b6b", barWidth: 3, barGap: 2, barRadius: 3, url: `/api/clips/${clips[sel].id}.wav` });
    ws.current.on("finish", () => setPlaying(false));
    setPhase("idle"); setParsed(null); setAsr(null); setDelta(null);
    return () => ws.current?.destroy();
  }, [clips, sel]);

  const clip = clips[sel];
  const showResult = (r: ASR, en: string | null) => {
    if (!r.ok) { setPhase("idle"); notify(r.error ?? "Transcription failed", "bad"); return; }
    setAsr(r); setParsed(r.parsed); setEnglish(en); setPick(null); setPhase("done");
  };
  const transcribe = async () => {
    if (!clip) return;
    setPhase("busy"); setDelta(null);
    try { showResult(await api.transcribeClip(clip.id), clip.en); } catch { setPhase("idle"); notify("Transcription failed", "bad"); }
  };
  const record = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null); setPhase("busy"); setDelta(null);
        try { showResult(await api.voiceUpload(new Blob(chunks, { type: mr.mimeType })), null); } catch { setPhase("idle"); notify("Transcription failed", "bad"); }
      };
      mr.start(); setRec(mr);
    } catch { notify("Microphone not available in this browser", "bad"); }
  };
  const parseFree = async () => { if (!free.trim()) return; const r = await api.parse(free); setAsr(null); setParsed(r.parsed); setEnglish(null); setPick(null); setPhase("done"); };
  const { net } = useStore();
  const pin = () => {
    const n = pick !== null && net ? net.nodes[pick] : null;
    if (n) setFocus({ lon: n.lon, lat: n.lat, label: n.label, kind: "complaint", at: Date.now() });
    else if (parsed?.lat) setFocus({ lon: parsed.lon!, lat: parsed.lat!, label: parsed.label ?? "", kind: "complaint", at: Date.now() });
  };
  const needsPick = !!parsed?.ambiguous && pick === null;
  const add = async () => {
    if (!parsed || needsPick) return;
    const r = await api.addComplaint(parsed.text, day, hour, asr ? "voice note" : "text", parsed.ambiguous ? pick : null);
    if (!r.added) { notify(`Not added: ${r.reason}`, "bad"); return; }
    pin(); await refresh();
    setDelta({ label: r.parsed.label ?? "", a: r.p_before ?? 0, b: r.p_after ?? 0 });
    notify(`Complaint added · ${r.parsed.label}`, "good");
  };

  return (
    <Shell title="Complaint & field-test intake" icon={<Mic size={18} />}>
      <div className="flex gap-2 mb-5">
        {([["voice", t("Citizen voice note"), Mic], ["kit", t("Field-test photo"), Camera]] as const).map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx("relative px-4 py-2 rounded-xl text-[13px] flex items-center gap-2", tab === k ? "text-abyss" : "text-slate-300 bg-white/5")}>
            {tab === k && <motion.span layoutId="itab" className="absolute inset-0 rounded-xl bg-gradient-to-r from-aqua to-cyan" />}
            <I size={15} className="relative" /><span className="relative">{l}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {tab === "voice" ? (
          <motion.div key="v" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex gap-2 flex-wrap items-center">
              {clips.map((c, i) => (
                <button key={c.id} onClick={() => setSel(i)} title={c.en} className={clsx("px-3 py-1.5 rounded-full text-[12.5px] border transition font-hindi", i === sel ? "border-aqua text-aqua bg-cyan/10" : "border-white/10 text-mist hover:text-white")} style={{ letterSpacing: 0 }}>
                  {c.text.split(/[ ,।]+/).slice(0, 3).join(" ")}…
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={record} className={clsx("px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold flex items-center gap-2", rec ? "bg-coral text-abyss" : "bg-white/8 text-slate-100 hover:bg-white/12")}>
                {rec ? <><Square size={13} />{t("Stop & transcribe")}</> : <><Mic size={13} />{t("Record live")}</>}
                {rec && <span className="w-2 h-2 rounded-full bg-abyss ping-soft" />}
              </button>
            </div>
            <div className="rounded-2xl bg-black/25 border border-white/5 p-4">
              <div className="flex items-center gap-3">
                <button onClick={() => { ws.current?.playPause(); setPlaying((p) => !p); }} className="w-11 h-11 rounded-full grid place-items-center bg-amber text-abyss shrink-0">
                  {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                </button>
                <div ref={waveRef} className="flex-1" />
              </div>
              <div className="text-[12px] text-mist mt-2 leading-snug">{t("Audio is processed on this laptop and not stored. No phone numbers are kept. Purpose: locating unsafe water only.")} Demo voices are synthetic (TTS).</div>
              {asrState && <div className={clsx("text-[11.5px] mt-1 flex items-center gap-1.5", asrState.state === "ready" ? "text-mint" : "text-amber")}><span className={clsx("w-1.5 h-1.5 rounded-full", asrState.state === "ready" ? "bg-mint" : "bg-amber ping-soft")} />{asrState.label}</div>}
            </div>
            <button onClick={transcribe} disabled={phase === "busy"} className="w-full rounded-xl py-3 font-display font-semibold bg-gradient-to-r from-aqua to-cyan text-abyss flex items-center justify-center gap-2 disabled:opacity-60">
              <Sparkles size={16} />{phase === "busy" ? "Listening… (Hindi speech recognition on this laptop)" : t("Transcribe & understand")}
            </button>
            <div className="flex gap-2">
              <input value={free} onChange={(e) => setFree(e.target.value)} onKeyDown={(e) => e.key === "Enter" && parseFree()} placeholder="…or type a complaint in Hindi, Hinglish or English" className="flex-1 bg-black/25 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-aqua" />
              <button onClick={parseFree} className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-[13px]">Parse</button>
            </div>
            <AnimatePresence>
              {phase === "busy" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-1.5 items-end h-10 px-2">
                  {Array.from({ length: 30 }).map((_, i) => (
                    <motion.span key={i} className="w-1.5 rounded-full bg-aqua/70" animate={{ height: [6, 30, 10, 24, 6] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.04 }} />
                  ))}
                </motion.div>
              )}
              {phase === "done" && parsed && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/8 bg-black/20 p-4 space-y-3"
                  onAnimationComplete={() => resultRef.current?.scrollIntoView({ behavior: SHOT ? "auto" : "smooth", block: "start" })} ref={resultRef}>
                  <div className="flex items-center justify-between"><div className="label">{t("Transcript")}</div>{asr && <div className="text-[10.5px] text-mist">{asr.source} · {asr.seconds.toFixed(1)} s</div>}</div>
                  <div className="font-hindi text-[18px] leading-relaxed text-white" style={{ letterSpacing: 0 }}><Typewriter text={parsed.text} /></div>
                  {english && <div className="text-[12.5px] text-mist">EN: {english}</div>}
                  <div className="label pt-1">{t("Understood")}</div>
                  <div className="flex flex-wrap gap-2">
                    {parsed.colour.map((c) => <Chip key={c} tone="amber">colour: {c}</Chip>)}
                    {parsed.odour.map((c) => <Chip key={c} tone="coral">odour: {c}</Chip>)}
                    {parsed.symptoms.map((c) => <Chip key={c} tone="violet">symptom: {c}</Chip>)}
                    {!parsed.water_quality && <Chip tone="mist">not a water-quality complaint</Chip>}
                  </div>
                  <div className="flex items-center gap-2 text-[13px]">
                    <MapPin size={15} className={parsed.node !== null ? "text-aqua shrink-0" : "text-mist shrink-0"} />
                    {parsed.node !== null && !parsed.ambiguous ? (
                      <span>Heard <b className="font-hindi">"{parsed.place_text}"</b> → <b className="text-aqua">{parsed.place_match}</b> ({parsed.match_score.toFixed(0)}% match) → {parsed.label} · ±{parsed.radius_m} m</span>
                    ) : parsed.ambiguous ? (
                      <span className="text-amber">Heard <b className="font-hindi">"{parsed.place_text}"</b>: {parsed.candidates} places match. It is never pinned to one by guesswork.</span>
                    ) : <span className="text-mist">No known landmark heard. Not geocoded. A field officer would call back.</span>}
                  </div>
                  {parsed.ambiguous && (
                    <div className="rounded-xl border border-amber/30 bg-amber/5 p-3">
                      <div className="text-[12.5px] text-amber mb-2">{t("Which one? Several places match:")} <span className="text-mist">(the officer asks the caller, or calls back)</span></div>
                      <div className="flex flex-wrap gap-1.5">
                        {parsed.options.map((o) => (
                          <button key={o.node} onClick={() => setPick(o.node)} className={clsx("px-2.5 py-1 rounded-full text-[12px] border", pick === o.node ? "border-amber bg-amber text-abyss font-semibold" : "border-white/15 text-slate-200 hover:border-amber/60")}>{o.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={pin} disabled={parsed.node === null || needsPick} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[13px] flex items-center gap-2 disabled:opacity-40"><MapPin size={14} />{t("Show on map")}</button>
                    <button onClick={add} disabled={parsed.node === null || !parsed.water_quality || needsPick} className="flex-1 px-4 py-2 rounded-xl bg-amber text-abyss font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-40"><Send size={14} />{t("Add to evidence")} (day {day}, {String(hour).padStart(2, "0")}:00)</button>
                  </div>
                  {delta && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-cyan/10 border border-cyan/20 px-3 py-2 text-[13px] text-aqua">
                      {delta.label}: probability {(100 * delta.a).toFixed(1)}% → <b>{(100 * delta.b).toFixed(1)}%</b>
                      <div className="text-[11.5px] text-mist mt-0.5">The ranking updates now. Alerts are decided only at each day's 18:00 run, so late evidence never rewrites an earlier decision.</div>
                    </motion.div>
                  )}
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
  const L = useL();
  const [res, setRes] = useState<KitResult | null>(null);
  const [scan, setScan] = useState(false);
  const [node, setNode] = useState<number | null>(null);
  const [delta, setDelta] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.suggested[0] && node === null) setNode(state.suggested[0].node); }, [state]);
  const run = async (p: Promise<KitResult>) => { setRes(null); setDelta(null); setScan(true); const r = await p; setRes(r); setTimeout(() => setScan(false), 1700); };
  const grad = (res?.scale ?? []).map((s) => `rgb(${s.rgb.join(",")}) ${100 * s.mg}%`).join(",");
  const add = async () => {
    if (!res?.ok || node === null || !net) return;
    const r = await api.addTest(node, day, hour, !!res.below, res.value);
    setFocus({ lon: net.nodes[node].lon, lat: net.nodes[node].lat, label: net.nodes[node].label, kind: "test", at: Date.now() });
    await refresh();
    setDelta(`${net.nodes[node].label}: probability ${(100 * r.p_before).toFixed(1)}% → ${(100 * r.p_after).toFixed(1)}%`);
    notify("Field test recorded", "good");
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => run(api.kitDemo(day))} className="flex-1 rounded-xl py-3 font-semibold bg-gradient-to-r from-aqua to-cyan text-abyss flex items-center justify-center gap-2"><Camera size={16} />Capture demo sample</button>
        <button onClick={() => file.current?.click()} className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-[13px] flex items-center gap-2"><Upload size={15} />Photo of a printed card</button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && run(api.kitUpload(e.target.files[0]))} />
      </div>
      <div className="text-[11px] text-mist">Designed for any phone camera; tested on synthetic photos only, with lab validation pending. The demo sample is rendered and labelled "dechlorinated". Screening only.</div>
      {!res && !scan && (
        <div className="grid grid-cols-5 gap-4 items-center">
          <img src="/field_card.png" className="col-span-3 rounded-2xl border border-white/10" />
          <div className="col-span-2 text-[12.5px] text-slate-300 space-y-2">
            <div className="label">The JalKavach field card</div>
            <p>Four corner markers square up any photo. A white patch corrects the lighting. The printed colour scale (copied from the kit's own comparator) sits under the same light as the sample, so colour casts are reduced.</p>
            <p className="text-mist">Print it, place the tube in the window, take a photo.</p>
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
            {res.rectified && <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} src={res.rectified} className="rounded-xl border border-white/10" />}
            {!scan && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                <div className="label">Free chlorine (screening)</div>
                <div className="relative h-5 rounded-full" style={{ background: `linear-gradient(90deg, ${grad})` }}>
                  <div className="absolute -top-1 bottom-[-4px] w-px bg-white" style={{ left: "20%" }} />
                  <div className="absolute -bottom-4 text-[9.5px] text-mist -translate-x-1/2" style={{ left: "20%" }}>0.2 · IS 10500</div>
                  {res.value !== null && (
                    <motion.div className="absolute -top-2 w-3 h-9 rounded-sm border-2 border-white shadow-lg"
                      initial={{ left: "0%" }} animate={{ left: `calc(${Math.min(100, 100 * res.value)}% - 6px)` }} transition={{ type: "spring", stiffness: 120, damping: 14 }} />
                  )}
                </div>
                <div className={clsx("mt-6 rounded-xl px-3 py-2.5 text-[13px] font-medium flex items-start gap-2", res.below ? "bg-coral/15 text-coral" : "bg-mint/15 text-mint")}>
                  {res.below ? <XCircle size={17} className="shrink-0 mt-px" /> : <CheckCircle2 size={17} className="shrink-0 mt-px" />}
                  <span>{res.ok ? `≈${res.value?.toFixed(2)} mg/L: ${res.below ? "below" : "at/above"} 0.2 mg/L` : res.message}</span>
                </div>
                <div className="label">Tap where sampled</div>
                <select value={node ?? ""} onChange={(e) => setNode(+e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-[12.5px]">
                  {net?.nodes.map((n) => <option key={n.i} value={n.i}>{state?.suggested.some((s) => s.node === n.i) ? "★ " : ""}{L(n)}</option>)}
                </select>
                <button onClick={add} disabled={!res.ok} className="w-full rounded-xl py-2.5 bg-amber text-abyss font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-40"><Beaker size={15} />Add field test (day {day})</button>
                {delta && <div className="rounded-xl bg-cyan/10 border border-cyan/20 px-3 py-2 text-[12.5px] text-aqua">{delta}</div>}
              </motion.div>
            )}
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
          initial={false} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, frac))) }} transition={{ duration: 0.9 }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

const ROLE_HELP: Record<string, string> = {
  "Assistant Engineer, Water Works (ward)": "AE or Sub-Engineer (city sets) · ward-level water engineer",
  "Assistant Engineer + Amrut Mitra field team": "AE + Amrut Mitras · trained field testers",
  "Executive Engineer, Water Works (zone)": "EE · zone-level engineer",
};

export function Escalation() {
  const { state, meta, day, hour, refresh, notify, setDay, role, setRole } = useStore();
  const t = useT();
  const [lang, setLang] = useState<"hi" | "en">("hi");
  const [why, setWhy] = useState("");
  const esc = state?.escalation;
  if (!meta) return null;
  const stages = meta.policy.stages;
  const roles = [...new Set([...stages.map((s) => s.owner), meta.policy.advisory_approver])];
  const act = async (a: string) => {
    const late = !!esc && esc.overdue_h > 0;
    if (late && !why.trim() && (a === "acknowledge" || a === "samples")) { notify("SLA missed: add a reason for the delay first", "bad"); return; }
    const r = await api.action(a, roles[role], day, hour, late ? why : "");
    if (!r.ok) notify(r.error ?? "not allowed", "bad"); else { notify(`Recorded in the audit trail: ${a.replace(/_/g, " ")}`, "good"); setWhy(""); await refresh(); }
  };
  const exportPack = async () => {
    const p = await api.exportPack(day, hour);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>${p.alert} pack</title><style>body{font-family:Inter,Arial;padding:40px;max-width:760px;margin:auto;color:#0b2340}
      pre{white-space:pre-wrap;font-size:13px;background:#f3f7fb;padding:14px;border-radius:8px}.wm{position:fixed;top:40%;left:10%;font-size:90px;color:rgba(255,0,0,.08);transform:rotate(-20deg);font-weight:800}</style></head>
      <body><div class="wm">SIMULATED</div><h2>JalKavach · ${p.alert}</h2><p>Generated Day ${p.day}, ${String(p.hour).padStart(2, "0")}:00 (simulation clock) · audit head <code>${(p.audit_head ?? "").slice(0, 16)}</code> · digest <code>${p.digest}</code></p>
      <p><b>Exposure (upper bound):</b> ≈ ${p.exposed_people.toLocaleString("en-IN")} residents can be supplied through the pipes in the 90% credible set.</p>
      <h3>Draft work order</h3><pre>${p.work_order ?? ""}</pre><h3>Draft advisory</h3><pre>${p.advisory ?? ""}</pre>
      <p style="font-size:12px;color:#555">Drafts only. Valid when approved and sent by the competent officer through official channels.</p></body></html>`);
    w.document.close(); w.print();
  };
  const adv = esc?.advisory?.split("\n") ?? [];
  const hi = adv.slice(0, 3).join("\n"), en = adv.slice(3).join("\n");
  return (
    <Shell title="Alert & the city's escalation clock" icon={<ShieldAlert size={18} />}>
      <div className="flex items-center gap-2 mb-4 text-[12.5px]">
        <UserRound size={15} className="text-aqua" /><span className="text-mist">{t("Signed in as (demo role)")}</span>
        <select value={role} onChange={(e) => setRole(+e.target.value)} className="bg-black/30 border border-white/10 rounded-lg px-2 py-1.5">
          {roles.map((r, i) => <option key={r} value={i}>{r}</option>)}
        </select>
      </div>
      {!esc ? (
        <div className="text-mist text-[14px] space-y-4">
          <p>No alert yet. Press play on the timeline: the alert opens on its own when the evidence crosses the city's calibrated threshold, and playback pauses there.</p>
          <button onClick={() => setDay(meta.alarm_day)} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[13px] text-aqua">Jump to day {meta.alarm_day}</button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="font-display text-2xl font-bold">Alert {esc.id}</div>
            <span className={clsx("px-3 py-1 rounded-full text-[12px] font-semibold", esc.status === "open" ? "bg-coral/15 text-coral" : esc.status === "confirmed" ? "bg-amber/15 text-amber" : "bg-mint/15 text-mint")}>{esc.status}</span>
            <div className="text-[12.5px] text-mist">opened Day {Math.round((new Date(esc.opened).getTime() - new Date(meta.base_date).getTime()) / 864e5 - 0.5)}, 18:00 · District Surveillance Officer informed (per city config; no live IDSP link) · ≈ {state!.exposed_people.toLocaleString("en-IN")} residents on the candidate pipes now (updates hourly)</div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {stages.map((s, k) => {
              const done = k < esc.stage_index || esc.status !== "open";
              const cur = k === esc.stage_index && esc.status === "open";
              const over = cur && esc.overdue_h > 0;
              const frac = cur ? (over ? 1 : 1 - esc.remaining_h / s.sla_hours) : done ? 1 : 0;
              const col = done ? "#34d399" : over ? "#ff6b6b" : cur ? "#67e8f9" : "#2b4a69";
              return (
                <motion.div key={s.id} layout className={clsx("rounded-2xl p-4 border", cur ? "border-aqua/40 bg-cyan/5" : "border-white/5 bg-black/15")}>
                  <Radial frac={frac} color={col}>
                    {done ? <Check size={20} className="text-mint" /> : <span className="font-display text-[13px] num" style={{ color: col }}>{cur ? (over ? `+${esc.overdue_h.toFixed(0)}h` : `${esc.remaining_h.toFixed(0)}h`) : `${s.sla_hours}h`}</span>}
                  </Radial>
                  <div className="mt-3 font-semibold text-[14px]">{t(s.label)}</div>
                  <div className="text-[12px] text-mist">{t(s.owner) !== s.owner ? t(s.owner) : ROLE_HELP[s.owner] ?? s.owner}</div>
                  <div className="text-[11.5px] text-mist mt-1">SLA {s.sla_hours} h {done ? "· done" : over ? "· missed" : ""}</div>
                </motion.div>
              );
            })}
          </div>
          {esc.status === "open" && (
            <div className="space-y-2">
              {esc.overdue_h > 0 && esc.stage_index < 2 && (
                <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("Reason for delay (recorded in the audit trail)")}
                  aria-label={t("Reason for delay (recorded in the audit trail)")}
                  className="w-full bg-black/25 border border-coral/40 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-coral" />
              )}
              <div className="flex gap-2 flex-wrap">
                {esc.stage_index === 0 && <button onClick={() => act("acknowledge")} className="h-12 px-6 rounded-xl bg-gradient-to-r from-aqua to-cyan text-abyss font-display font-semibold text-[15px]">{t("Acknowledge alert")}</button>}
                {esc.stage_index === 1 && <button onClick={() => act("samples")} className="h-12 px-6 rounded-xl bg-gradient-to-r from-aqua to-cyan text-abyss font-display font-semibold text-[15px]">{t("Field tests taken")}</button>}
                {esc.stage_index === 2 && <>
                  <button onClick={() => act("confirm")} className="h-12 px-6 rounded-xl bg-coral text-abyss font-display font-semibold text-[15px]">{t("Confirm ingress · create drafts")}</button>
                  <button onClick={() => act("clear")} className="h-12 px-5 rounded-xl bg-white/5 text-[13px]">{t("Clear (false alarm)")}</button>
                </>}
              </div>
            </div>
          )}
          <div>
            <div className="label mb-2">Escalation ladder for this stage · used only if the SLA is missed (one step every {meta.policy.escalate_every_hours} h)</div>
            <div className="relative pl-6 space-y-1.5">
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-white/10" />
              {meta.policy.chain.map((c, i) => {
                const lit = esc.escalated_to.includes(c);
                return (
                  <div key={c} className="relative flex items-center gap-2 text-[12.5px]">
                    <span className={clsx("absolute -left-[19px] w-2.5 h-2.5 rounded-full border-2", lit ? "bg-coral border-coral" : "bg-abyss border-white/25")} />
                    <span className={lit ? "text-coral" : "text-slate-300"}>{t(c)}</span>
                    <span className="text-mist text-[11.5px]">{lit ? "· notified" : i === 0 ? "· notified when the SLA is missed" : `· if still missed ${i * meta.policy.escalate_every_hours} h later`}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-[12px] text-mist mt-2">The city sets every owner, SLA and step. Acting on time keeps the record clean: the trail protects officers who act.</div>
          </div>
          {esc.work_order && (
            <div className="grid grid-cols-2 gap-4">
              <div className="relative rounded-2xl bg-black/25 border border-white/8 p-4">
                <div className="label mb-2 flex items-center gap-1.5"><FileText size={12} />Draft work order</div>
                <pre className="text-[11.5px] whitespace-pre-wrap text-slate-200 font-mono leading-relaxed">{esc.work_order}</pre>
                <button onClick={() => act("approve_work_order")} disabled={esc.approved.includes("work_order")} className="mt-3 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px] disabled:opacity-50">Approve (Executive Engineer)</button>
                <AnimatePresence>{esc.approved.includes("work_order") && <Stampy />}</AnimatePresence>
              </div>
              <div className="relative rounded-2xl bg-black/25 border border-white/8 p-4">
                <div className="flex items-center justify-between mb-2"><div className="label flex items-center gap-1.5"><Languages size={12} />Draft boil-water advisory</div>
                  <div className="flex text-[11px] rounded-lg overflow-hidden border border-white/10">
                    {(["hi", "en"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={clsx("px-2 py-0.5", lang === l ? "bg-cyan/20 text-aqua" : "text-mist")}>{l === "hi" ? "हिंदी" : "EN"}</button>)}
                  </div></div>
                <div className={clsx("text-[13px] whitespace-pre-wrap leading-relaxed text-slate-100", lang === "hi" && "font-hindi")} style={{ letterSpacing: 0 }}>{lang === "hi" ? hi : en}</div>
                <button onClick={() => act("approve_advisory")} disabled={esc.approved.includes("advisory")} className="mt-3 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px] disabled:opacity-50">Approve ({meta.policy.advisory_approver})</button>
                <AnimatePresence>{esc.approved.includes("advisory") && <Stampy />}</AnimatePresence>
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <div className="text-[11.5px] text-mist flex items-center gap-2 flex-1"><Lock size={13} />JalKavach never sends anything. Approval is recorded; the officer sends through official channels.</div>
                <button onClick={exportPack} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px] flex items-center gap-2"><Printer size={14} />Export printable pack</button>
              </div>
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
function describe(r: AuditRow): string {
  const p = r.payload as any;
  switch (r.action) {
    case "alert_opened": return `Alert opened by the engine · owner: ${p.owner}`;
    case "escalated": return p.overdue_hours > 0 ? `SLA still missed after ${p.overdue_hours} h → ${p.to} notified` : `SLA missed → ${p.to} notified`;
    case "complaint_added": return `Citizen complaint added (${[...(p.colour ?? []), ...(p.odour ?? []), ...(p.symptoms ?? [])].join(", ") || "water quality"})`;
    case "field_test_added": return `Field test: ${p.mg_l ?? "?"} mg/L ${p.below_0_2 ? "(below 0.2)" : "(ok)"}`;
    case "drafts_created": return "Draft work order and advisory created";
    default:
      if (r.action.startsWith("stage_done:")) {
        const id = r.action.replace("stage_done:", "");
        const what = id === "acknowledge" ? "Alert acknowledged" : id === "sample" ? "Field tests taken"
          : String(p.note ?? "").startsWith("cleared") ? "Alert cleared (false alarm)" : id === "decide" ? "Ingress confirmed · work order drafted" : `${id} done`;
        return `${what}${p.on_time ? " · within SLA" : " · after SLA"}${p.reason_for_delay ? ` · reason: "${p.reason_for_delay}"` : ""}`;
      }
      if (r.action.startsWith("approved:")) return `Approved: ${r.action.replace("approved:", "").replace("_", " ")}`;
      return r.action;
  }
}

export function Audit() {
  const { state, day, hour } = useStore();
  const t = useT();
  const [data, setData] = useState<{ ok: boolean; bad: number | null; rows: AuditRow[] } | null>(null);
  const [broken, setBroken] = useState<number | null>(null);
  const [hashes, setHashes] = useState(false);
  useEffect(() => { api.audit(day, hour).then(setData); setBroken(null); }, [state]);
  const tamper = async () => { const r = await api.tamper(day, hour); setBroken(r.broken_at); };
  const fmt = (ts: string) => { const d = new Date(ts); const dd = Math.round((d.getTime() - new Date("2026-12-01T00:00:00").getTime()) / 864e5 - 0.5); return `Day ${dd} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  return (
    <Shell title="Tamper-evident audit trail" icon={<Link2 size={18} />} wide>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className={clsx("px-3 py-1.5 rounded-full text-[12.5px] font-semibold flex items-center gap-2", data?.ok ? "bg-mint/15 text-mint" : "bg-coral/15 text-coral")}>
          {data?.ok ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}Hash chain {data?.ok ? "intact" : "broken"} · {data?.rows.length ?? 0} entries
        </div>
        <button onClick={tamper} className="px-4 py-2 rounded-xl bg-coral/15 text-coral hover:bg-coral/25 text-[12.5px]">Tamper test: edit entry #1 in a copy</button>
        <button onClick={() => setHashes((x) => !x)} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[12.5px] flex items-center gap-1.5"><Hash size={13} />{hashes ? "Hide" : "Show"} hashes</button>
        <div className="text-[12.5px] text-mist">Every action, by whom and when. Green dots are people; blue dots are the engine.</div>
      </div>
      {!data?.rows.length ? <div className="text-mist text-[13px]">No entries yet. Move the timeline to the alert.</div> : (
        <div className="relative pl-8 max-w-[900px]">
          <div className="absolute left-[13px] top-2 bottom-2 w-0.5 bg-white/10" />
          {data.rows.map((r, i) => {
            const isBroken = broken !== null && r.seq >= broken;
            const human = !r.actor.startsWith("JalKavach");
            return (
              <motion.div key={r.seq} initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: isBroken && r.seq === broken ? [0, -6, 6, -4, 4, 0] : 0 }}
                transition={{ delay: isBroken ? 0.12 * (r.seq - (broken ?? 0)) : i * 0.04 }} className="relative mb-2.5">
                <motion.div className={clsx("absolute -left-[26px] top-3.5 w-3.5 h-3.5 rounded-full border-2", isBroken ? "bg-coral border-coral" : human ? "bg-mint border-mint" : "bg-abyss border-aqua")}
                  animate={isBroken ? { scale: [1, 1.4, 1] } : {}} transition={{ delay: 0.12 * (r.seq - (broken ?? 0)) }} />
                <div className={clsx("rounded-2xl px-4 py-3 border flex items-center gap-4", isBroken ? "border-coral/50 bg-coral/10" : "border-white/8 bg-black/20")}>
                  <div className="w-32 shrink-0 text-[12px] text-mist num">#{r.seq} · {fmt(r.ts)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] text-slate-100">{describe(r)}</div>
                    <div className={clsx("text-[12px]", human ? "text-mint/90" : "text-mist")}>{t(r.actor)}</div>
                  </div>
                  {hashes && <div className={clsx("font-mono text-[10.5px] text-right", isBroken ? "text-coral" : "text-aqua/80")}>{r.hash.slice(0, 16)}…<br /><span className="text-mist/60">prev {r.prev_hash.slice(0, 10)}…</span></div>}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
      {broken !== null && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-2xl border border-coral/40 bg-coral/10 p-4 text-[13px] text-coral">
          Chain broken at #{broken}. One character was changed in a copy of entry #{broken}; its hash no longer matches, so every later link fails. Edits after the fact are detectable.
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
  const lines: Record<string, [string, string, number]> = { F: ["JalKavach", "#67e8f9", 3.2], H: ["Hospital-only", "#ff6b6b", 2.6], C: ["Complaints only", "#3B5873", 1.2], CC: ["Complaint-count alarm", "#3B5873", 1.2], S: ["Pharmacy only", "#3B5873", 1.2], T: ["Field tests only", "#3B5873", 1.2] };
  const cdf = res ? Array.from({ length: 15 }, (_, x) => ({ x, ...Object.fromEntries(Object.entries(res.cdf).map(([k, v]) => [k, Math.round(100 * v[x])])) })) : [];
  return (
    <Shell title="Evidence · held-out simulation, pre-registered" icon={<Sparkles size={18} />} wide>
      <div className="grid grid-cols-4 gap-3">
        {[
          [`+${Math.round(100 * h.det_gain_vs_CC[0])} pts`, `more events caught within 21 days than a simple complaint-count alarm, ≤1 false alarm per quarter (95% CI +${Math.round(100 * h.det_gain_vs_CC[1])} to +${Math.round(100 * h.det_gain_vs_CC[2])})`],
          [pct(h.top3_F), `true junction in the top 3, three days after the alert (complaints only: ${pct(h.top3_C)}; centroid: ${pct(h.top3_CC)}; ${h.top3_F_uniform !== null ? pct(h.top3_F_uniform) : "–"} with uniformly placed ingress)`],
          [`${h.lead_days[0]} days`, `median lead over a hospital-only baseline (95% CI ${h.lead_days[1]}–${h.lead_days[2]}; its misses counted at day 21)`],
          [pct(h.coverage), `of 90% credible sets contained the true junction: conservative (${h.coverage_uniform !== null ? pct(h.coverage_uniform) : "–"} when ingress ignores pipe risk)`],
        ].map(([v, l], i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-2xl bg-black/20 border border-white/5 p-4">
            <div className="font-display text-[38px] leading-none font-bold bg-gradient-to-r from-aqua to-cyan bg-clip-text text-transparent">{v}</div>
            <div className="text-[12px] text-mist mt-2 leading-snug">{l}</div>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-4 mt-5">
        <div className="col-span-3 rounded-2xl bg-black/20 border border-white/5 p-4">
          <div className="label mb-1">Share of events detected, by days after onset · same false-alarm budget for every method</div>
          <div className="h-[250px]">
            <ResponsiveContainer>
              <LineChart data={cdf} margin={{ top: 14, right: 170, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#14304c" strokeDasharray="3 3" />
                <XAxis dataKey="x" stroke="#8fb3d1" fontSize={11} tickFormatter={(x) => `${x}d`} />
                <YAxis stroke="#8fb3d1" fontSize={11} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "#061422", border: "1px solid #15304b", borderRadius: 10, fontSize: 12 }} />
                <ReferenceLine y={50} stroke="#cfe6ff" strokeOpacity={0.25} strokeDasharray="4 4" />
                {Object.keys(lines).filter((k) => res?.cdf[k]).map((k) => (
                  <Line key={k} type="monotone" dataKey={k} name={lines[k][0]} stroke={lines[k][1]} strokeWidth={lines[k][2]} dot={false} isAnimationActive={!SHOT} animationDuration={1600}>
                    {(k === "F" || k === "H") && <LabelList dataKey={k} content={(p: any) => p.index === 14 ? <text x={p.x + 6} y={p.y + 4} fill={lines[k][1]} fontSize={12} fontWeight={600}>{lines[k][0]}</text> : null} />}
                  </Line>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[12px] text-mist leading-snug">Grey lines: complaints only, complaint-count alarm, pharmacy only, field tests only. Budget: ≤1 false alarm per ward per quarter. At a stricter monthly budget the gain over the complaint-count alarm is {h.det_gain_vs_CC_monthly[0] >= 0 ? "+" : ""}{Math.round(100 * h.det_gain_vs_CC_monthly[0])} pts [{Math.round(100 * h.det_gain_vs_CC_monthly[1])}, {Math.round(100 * h.det_gain_vs_CC_monthly[2])}]{h.det_gain_vs_CC_monthly[1] <= 0 ? ", not significant" : ""}. Localisation: n = {h.n_main} detected main-set events; {h.n_scenarios.toLocaleString("en-IN")} scenarios in all, incl. no-event runs and sweeps.</div>
        </div>
        <div className="col-span-2 space-y-3">
          <div className="rounded-2xl bg-black/20 border border-white/5 p-4">
            <div className="label mb-2">How it was tested</div>
            <ul className="text-[12.5px] text-slate-300 space-y-1.5 list-disc ml-4">
              <li>Metrics and thresholds written down before the first run (committed alongside the results)</li>
              <li>Held-out scenarios on fresh seeds; EPANET Net3 as a second network</li>
              <li>10 perturbed pipe networks; a complaint process the engine does not assume</li>
              <li>True ingress drawn from a different risk model than the engine's prior</li>
              <li>Baselines: hospital-admission and complaint-count alarms, complaint centroid</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-amber/30 bg-amber/5 p-4">
            <div className="label mb-2 text-amber">What did not work as well (as measured)</div>
            <ul className="text-[12.5px] text-amber/90 space-y-1.5 list-disc ml-4">
              <li>Fusion does not alarm <i>earlier</i> or catch <i>more</i> events than the complaints-only model ({pct(h.detected_F)} vs {pct(h.detected_C)}). The +{Math.round(100 * h.det_gain_vs_CC[0])} pts is the engine vs. a simple count alarm; fusion's own gain is <i>where</i>: {pct(h.top3_F)} vs {pct(h.top3_C)} top-3.</li>
              <li>Intermittent-supply prior vs. a 24×7 prior: not significant.</li>
              <li>Larger wards localise less well: {pct(h.top3_F)} top-3 here ({h.n_junctions} junctions), {res ? <> vs. {pct(res.net3.top3)} on the smaller Net3</> : null}.</li>
              <li>Information-gain test routing ≈ random in the pre-registered run (median {h.routing.info_gain.median} vs {h.routing.random.median} tests){h.routing_ext ? <>; a larger run declared in advance found it ahead: {pct(h.routing_ext.reached_top3.info_gain)} vs {pct(h.routing_ext.reached_top3.random)} reach the top 3 (+{Math.round(100 * h.routing_ext.diff_reached[0])} pts, 95% CI {Math.round(100 * h.routing_ext.diff_reached[1])}–{Math.round(100 * h.routing_ext.diff_reached[2])})</> : null}.</li>
              <li>Lower detection where people report less.</li>
              <li>Everything here is simulated, not field data.</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-black/20 border border-white/5 p-4">
        <div className="label mb-2">Why days matter · Indore, winter 2025–26 (press reports)</div>
        <div className="flex items-center gap-2 text-[12.5px] text-slate-200 flex-wrap">
          {["Residents complain of smelly, discoloured tap water for weeks¹", "Diarrhoea and vomiting surge; hospitals fill²", "Lab tests confirm sewage in a leaking pipeline³", "Officials act after people have died²"].map((x, i, a) => (
            <span key={i} className="flex items-center gap-2"><span className={clsx("rounded-xl px-3 py-1.5 border", i === 0 ? "border-amber/40 text-amber" : i === a.length - 1 ? "border-coral/40 text-coral" : "border-white/10")}>{x}</span>{i < a.length - 1 && <span className="text-mist">→</span>}</span>
          ))}
        </div>
        <div className="text-[11.5px] text-mist mt-2">¹ ThePrint; Free Press Journal, Jan 2026. ² Deccan Herald; Business Today, Jan 2026 (reported deaths vary by source). ³ Deccan Herald, Jan 2026. JalKavach is built for the gap between the first and second boxes.</div>
      </div>
      {res && <div className="mt-4 text-[11.5px] text-mist">Second network (EPANET Net3): lead {res.net3.lead_F_vs_H[0]} days [{res.net3.lead_F_vs_H[1]}–{res.net3.lead_F_vs_H[2]}]. Full tables: results/RESULTS.md.</div>}
    </Shell>
  );
}

/* ------------------------------------------------------------------- vision */
function WardBoard() {
  const { state } = useStore();
  const col = state?.status === "ALERT" ? "#ff6b6b" : "#34d399";
  return (
    <div className="rounded-2xl bg-black/20 border border-white/5 p-4">
      <div className="label mb-2">What the Commissioner could see · illustration</div>
      <div className="grid gap-[5px]" style={{ gridTemplateColumns: "repeat(17, minmax(0, 1fr))" }}>
        {Array.from({ length: 85 }, (_, i) => (
          i === 0
            ? <motion.div key={i} title="Ward 00 · live demo" className="aspect-square rounded-[4px]" style={{ background: col, boxShadow: `0 0 12px ${col}` }}
                animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
            : <div key={i} title={`Ward ${String(i).padStart(2, "0")} · not connected`} className="aspect-square rounded-[4px] border border-white/10 bg-white/[.03]" />
        ))}
      </div>
      <div className="text-[12px] text-mist mt-2 leading-snug">One tile per ward. Only Ward 00 (this demo) is live; the other 84 are empty until a city connects them. Each tile would carry status, the stage clock and the last field test.</div>
    </div>
  );
}

export function Vision() {
  const steps = [
    { k: "1 ward", t: "Pilot", d: "One ward, CSR-funded, no procurement. The utility's network map and complaint log replace the synthetic layers.", n: "₹12 L onboarding" },
    { k: "85 wards", t: "Indore", d: "The city's own clock on every ward, from Swachh to Surakshit.", n: "≈ ₹1.3–1.7 cr / yr" },
    { k: "Simhastha 2028", t: "Ujjain", d: "Temporary networks for crores of pilgrims: the template is ready to pilot.", n: "mela-grid template" },
    { k: "~400 ULBs", t: "Madhya Pradesh", d: "Put the state's Amrut Mitra field tests on one map (80,976 reported by Jan 2026).", n: "state rate contract" },
    { k: "AMRUT cities", t: "India 2036", d: "Tap-water safety as visible to a city as its air quality, published at the city's discretion.", n: "open core + managed service" },
  ];
  return (
    <Shell title="2036 · from one ward to every tap" icon={<Sparkles size={18} />} wide>
      <div className="grid grid-cols-5 gap-5">
        <div className="col-span-3 space-y-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-cyan/30 bg-cyan/5 px-5 py-4">
            <div className="label text-aqua">Message for the 2036 Capsule</div>
            <div className="font-display text-[18px] mt-1.5 text-slate-100 leading-snug">“Dear 2036: we built this so a city hears it from its own signals, not from a hospital bed. If your city knows before its hospitals do, it worked.”</div>
            <div className="font-hindi text-[16px] text-[#FFB27A] mt-2" style={{ letterSpacing: 0 }}>लोकमाता देवी अहिल्याबाई ने घाट और कुएँ बनवाए; हम हर नल का पानी सुरक्षित रखेंगे।</div>
          </motion.div>
          <div className="relative">
            <div className="absolute left-[21px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-aqua via-cyan to-azure opacity-50" />
            {steps.map((s, i) => (
              <motion.div key={s.k} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 * i }} className="relative flex gap-4 mb-2">
                <motion.div className="w-11 h-11 rounded-2xl grid place-items-center font-display font-bold text-abyss shrink-0 z-10"
                  style={{ background: `linear-gradient(135deg, #67e8f9, ${["#22a6f2", "#2b8cf0", "#3a6ff0", "#2f5be8", "#2546e8"][i]})` }}
                  initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.12 * i + 0.1, type: "spring" }}>{i + 1}</motion.div>
                <div className="flex-1 rounded-2xl bg-black/20 border border-white/5 px-4 py-2">
                  <div className="flex items-baseline gap-3"><div className="font-display text-[17px] font-semibold">{s.t}</div><div className="text-aqua text-[13px]">{s.k}</div><div className="flex-1" /><div className="text-[12px] text-mist">{s.n}</div></div>
                  <div className="text-[13px] text-slate-300 mt-0.5">{s.d}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="col-span-2 space-y-4">
          <WardBoard />
          <div className="rounded-2xl border border-[#FF9F43]/30 bg-[#FF9F43]/5 p-4">
            <div className="font-hindi text-[18px] text-[#FFB27A]" style={{ letterSpacing: 0 }}>स्वच्छता में नंबर 1; अब सुरक्षा में भी।</div>
            <div className="font-display text-[15px] text-slate-200 mt-1">From <b className="text-mint">Swachh</b> to <b className="text-aqua">Surakshit</b></div>
          </div>
          <div className="rounded-2xl bg-black/20 border border-white/5 p-4 text-[12.5px] text-slate-300 space-y-1.5">
            <div className="label mb-1">Pilot readiness</div>
            <div>Needs from the city: the ward's pipe map, a complaint-log export, and an SLA config. Pharmacy data is optional.</div>
            <div>Engine: open source (Apache-2.0), built toward the Digital Public Goods standard. No patents.</div>
            <div className="text-aqua">Our ask: that the city names the first pilot ward.</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
