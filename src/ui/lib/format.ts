/** A value for display: 4 significant figures, plain notation where readable, exact zeros as 0. */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}
