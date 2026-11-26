export type NodeT = {
  i: number; lat: number; lon: number; pop: number; cl: number; label: string;
  age: number | null; sewer: number; deficit: number; prior: number;
};
export type PipeT = {
  id: string; a: number; b: number; from: number; to: number; street: string;
  diameter_mm: number; age: number; sewer: boolean; flow_lps: number; velocity: number;
};
export type Network = {
  label: string; provenance: Record<string, string>; nodes: NodeT[]; pipes: PipeT[];
  pois: { name: string; kind: string; lat: number; lon: number; pharmacy: boolean }[];
  trips: { p: [number, number][]; t: number[] }[]; trip_loop_s: number; source: number;
  buildings: { c: [number, number][]; l: number | null }[]; center: [number, number];
};
export type Stage = { id: string; label: string; owner: string; sla_hours: number };
export type Meta = {
  days: number; alarm_day: number; threshold: number; base_date: string; note: string;
  policy: { stages: Stage[]; chain: string[]; advisory_approver: string; notify_on_open: string[] };
  headline: { lead_days: [number, number, number]; detected_F: number; detected_H: number; top3_F: number; top3_CC: number; coverage: number };
};
export type Ranked = { node: number; p: number; label: string };
export type Escalation = {
  id: string; opened: string; status: string; stage_index: number; stage: string; owner: string | null;
  due: string | null; remaining_h: number; overdue_h: number; escalated_to: string[];
  work_order: string | null; advisory: string | null;
};
export type DayState = {
  day: number; hour: number; now: string; p_event: number; alert_index: number;
  status: "ALERT" | "WATCH" | "NORMAL"; p_location: number[]; top: Ranked[]; credible90: number[];
  contributions: Record<string, number>; map_onset: number; map_intensity: number;
  suggested: (Ranked & { eig: number })[];
  series: { complaints: number[]; pharmacy: number[]; alert_index: number[] };
  complaints: { node: number; day: number; count: number }[];
  tests: { node: number; day: number; failed: boolean; kind: string }[];
  plume: { node: number; arrival_h: number[]; reach: number[] };
  escalation: Escalation | null; extras: { complaints: number; tests: number };
};
export type Parsed = {
  text: string; colour: string[]; odour: string[]; symptoms: string[]; place_text: string | null;
  place_match: string | null; match_score: number; node: number | null; radius_m: number | null;
  water_quality: boolean; label?: string; lat?: number; lon?: number;
};
export type Clip = { id: string; text: string; en: string; transcript: string | null; asr: string | null };
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
  addComplaint: (text: string, day: number, hour: number) =>
    post("/api/complaint", { text, day, hour, add: true }).then(j<{ added: boolean; parsed: Parsed; reason?: string }>),
  kitDemo: (seed: number) => {
    const f = new FormData(); f.append("demo", "true"); f.append("seed", String(seed));
    return fetch("/api/kit", { method: "POST", body: f }).then(j<KitResult>);
  },
  kitUpload: (file: File) => {
    const f = new FormData(); f.append("file", file);
    return fetch("/api/kit", { method: "POST", body: f }).then(j<KitResult>);
  },
  addTest: (node: number, day: number, hour: number, failed: boolean, value: number | null) =>
    post("/api/test", { node, day, hour, failed, value }).then(j<{ added: boolean }>),
  action: (action: string, actor: string, day: number, hour: number) =>
    post(`/api/alert/${action}`, { actor, day, hour }).then(j<{ ok: boolean; error?: string }>),
  audit: () => fetch("/api/audit").then(j<{ ok: boolean; bad: number | null; rows: AuditRow[] }>),
  tamper: () => post("/api/audit/tamper-test").then(j<{ ok: boolean; broken_at: number | null; rows: number }>),
  results: () => fetch("/api/results").then(j<{ summary: any; cdf: Record<string, number[]>; net3: any }>),
};
