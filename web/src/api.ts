export type NodeT = {
  i: number; lat: number; lon: number; pop: number; cl: number; label: string; label_hi: string;
  age: number | null; sewer: number; deficit: number; prior: number;
};
export type PipeT = {
  id: string; a: number; b: number; from: number; to: number; street: string;
  diameter_mm: number; age: number; sewer: boolean; flow_lps: number; velocity: number;
};
export type Network = {
  label: string; provenance: Record<string, string>; nodes: NodeT[]; pipes: PipeT[];
  pois: { name: string; name_hi: string; kind: string; lat: number; lon: number; pharmacy: boolean }[];
  trips: { p: [number, number][]; t: number[] }[]; trip_loop_s: number; source: number;
  buildings: { c: [number, number][]; l: number | null }[]; center: [number, number]; total_km: number;
};
export type Stage = { id: string; label: string; owner: string; sla_hours: number };
export type Meta = {
  days: number; alarm_day: number; threshold: number; base_date: string; note: string; eval_hour: number;
  supply_windows: [number, number][];
  scales: { complaints: number; pharmacy: number; pharmacy_base: number };
  policy: { stages: Stage[]; chain: string[]; advisory_approver: string; notify_on_open: string[]; escalate_every_hours: number };
  headline: {
    lead_days: [number, number, number]; detected_F: number; detected_H: number; detected_CC: number;
    det_gain_vs_CC: [number, number, number]; det_gain_vs_CC_monthly: [number, number, number]; equity_detected: Record<string, number>; routing: Record<"info_gain" | "random", { median: number; mean: number }>; n_junctions: number; top3_F: number; top3_C: number; top3_CC: number;
    top3_F_uniform: number | null; coverage: number; coverage_uniform: number | null; n_main: number; n_scenarios: number;
  };
};
export type Ranked = { node: number; p: number; label: string; label_hi?: string };
export type Escalation = {
  id: string; opened: string; status: string; stage_index: number; stage: string; owner: string | null;
  due: string | null; remaining_h: number; overdue_h: number; escalated_to: string[];
  work_order: string | null; advisory: string | null; approved: string[];
};
export type DayState = {
  day: number; hour: number; eval_day: number; now: string; supply_on: boolean; p_event: number; alert_index: number;
  status: "ALERT" | "NORMAL"; p_location: number[]; top: Ranked[]; credible90: number[];
  search_km: number; total_km: number; onset_range: [number, number]; exposed_people: number;
  contributions: Record<string, number>;
  suggested: (Ranked & { eig: number })[];
  series: { complaints: number[]; pharmacy: number[]; alert_index: number[] };
  complaints: { node: number; day: number; count: number }[];
  tests: { node: number; day: number; failed: boolean; kind: string }[];
  plume: { node: number; p: number; arrival_h: number[]; reach: number[] };
  truth: { node: number; label: string; label_hi: string; onset_day: number; rank: number } | null;
  escalation: Escalation | null; extras: { complaints: number; tests: number; actions: number };
};
export type Parsed = {
  text: string; colour: string[]; odour: string[]; symptoms: string[]; place_text: string | null;
  place_match: string | null; match_score: number; node: number | null; radius_m: number | null;
  water_quality: boolean; label?: string; lat?: number; lon?: number;
  candidates: number; ambiguous: boolean; options: { name: string; node: number; label: string }[];
};
export type Clip = { id: string; text: string; en: string; transcript: string | null };
export type ASR = { ok: boolean; text: string; source: string; seconds: number; parsed: Parsed; error?: string };
export type KitResult = {
  ok: boolean; value: number | null; below: boolean | null; margin: number; message: string;
  markers: { id: number; pts: [number, number][] }[]; photo: string; rectified: string | null;
  scale: { mg: number; rgb: [number, number, number] }[];
};
export type AuditRow = { seq: number; ts: string; actor: string; action: string; alert_id: string; payload: Record<string, unknown>; prev_hash: string; hash: string };

const j = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
};
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export const api = {
  meta: () => fetch("/api/meta").then(j<Meta>),
  network: () => fetch("/api/network").then(j<Network>),
  day: (d: number, h: number) => fetch(`/api/day/${d}?hour=${h}`).then(j<DayState>),
  reset: () => post("/api/reset").then(j<{ ok: boolean }>),
  clips: () => fetch("/api/clips").then(j<Clip[]>),
  parse: (text: string) => post("/api/complaint", { text }).then(j<{ parsed: Parsed }>),
  addComplaint: (text: string, day: number, hour: number, channel = "voice note", node: number | null = null) =>
    post("/api/complaint", { text, day, hour, add: true, channel, node }).then(j<{ added: boolean; parsed: Parsed; reason?: string; p_before?: number; p_after?: number }>),
  asrStatus: () => fetch("/api/asr/status").then(j<{ state: "warming" | "ready" | "unavailable"; label: string }>),
  transcribeClip: (id: string) => post(`/api/transcribe/${id}`).then(j<ASR>),
  voiceUpload: (blob: Blob) => {
    const f = new FormData(); f.append("file", blob, "mic.webm");
    return fetch("/api/voice", { method: "POST", body: f }).then(j<ASR>);
  },
  exportPack: (d: number, h: number) => fetch(`/api/export?day=${d}&hour=${h}`).then(j<{ alert: string | null; work_order: string | null; advisory: string | null; audit_head: string | null; generated: string; digest: string; exposed_people: number; day: number; hour: number }>),
  kitDemo: (seed: number) => {
    const f = new FormData(); f.append("demo", "true"); f.append("seed", String(seed));
    return fetch("/api/kit", { method: "POST", body: f }).then(j<KitResult>);
  },
  kitUpload: (file: File) => {
    const f = new FormData(); f.append("file", file);
    return fetch("/api/kit", { method: "POST", body: f }).then(j<KitResult>);
  },
  addTest: (node: number, day: number, hour: number, failed: boolean, value: number | null) =>
    post("/api/test", { node, day, hour, failed, value }).then(j<{ added: boolean; p_before: number; p_after: number }>),
  action: (action: string, actor: string, day: number, hour: number, note = "") =>
    post(`/api/alert/${action}`, { actor, day, hour, note }).then(j<{ ok: boolean; error?: string }>),
  audit: (d: number, h: number) => fetch(`/api/audit?day=${d}&hour=${h}`).then(j<{ ok: boolean; bad: number | null; rows: AuditRow[] }>),
  tamper: (d: number, h: number) => post(`/api/audit/tamper-test?day=${d}&hour=${h}`).then(j<{ ok: boolean; broken_at: number | null; rows: number }>),
  results: () => fetch("/api/results").then(j<{ summary: any; cdf: Record<string, number[]>; net3: any }>),
};
