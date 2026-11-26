/** Percent with Python-style round-half-to-even, so the UI matches results/RESULTS.md exactly. */
export function pct(x: number): string {
  const v = x * 100;
  const f = Math.floor(v);
  const r = v - f;
  const n = Math.abs(r - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(v);
  return `${n}%`;
}
