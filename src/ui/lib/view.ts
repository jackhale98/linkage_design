// Canvas view transform (world units, y up) and adaptive grid spacing.
// Pure functions so they can be unit tested.

export interface View {
  /** World coordinates at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Pixels per world unit. */
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 1e-3;
export const MAX_SCALE = 1e4;

export function worldToScreen(v: View, size: Size, x: number, y: number): [number, number] {
  return [size.width / 2 + (x - v.cx) * v.scale, size.height / 2 - (y - v.cy) * v.scale];
}

export function screenToWorld(v: View, size: Size, sx: number, sy: number): [number, number] {
  return [v.cx + (sx - size.width / 2) / v.scale, v.cy - (sy - size.height / 2) / v.scale];
}

/** Zoom by `factor` keeping the world point under screen position (sx, sy) fixed. */
export function zoomAt(v: View, size: Size, sx: number, sy: number, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const [wx, wy] = screenToWorld(v, size, sx, sy);
  return {
    scale,
    cx: wx - (sx - size.width / 2) / scale,
    cy: wy + (sy - size.height / 2) / scale,
  };
}

/** Pan by a screen-space delta. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale };
}

/** Fit a world-space box into the canvas with a margin in pixels. */
export function fitBox(
  size: Size,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  margin = 48,
): View {
  const w = Math.max(box.maxX - box.minX, 1e-9);
  const h = Math.max(box.maxY - box.minY, 1e-9);
  const scale = Math.min((size.width - 2 * margin) / w, (size.height - 2 * margin) / h);
  return {
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
  };
}

/** Smallest 1-2-5 step whose on-screen size is at least `minPx`. */
export function niceStep(scale: number, minPx: number): number {
  const raw = minPx / scale;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= raw * (1 - 1e-9)) return m * base;
  return 10 * base;
}

export interface GridSpacing {
  minor: number;
  major: number;
}

/** Minor lines at least 10 px apart; major lines every 5 or 10 minor steps (a 1-2-5 value). */
export function gridSpacing(scale: number): GridSpacing {
  const minor = niceStep(scale, 10);
  const lead = Math.round(minor / 10 ** Math.floor(Math.log10(minor)));
  return { minor, major: minor * (lead === 2 ? 5 : 10) };
}

/** SVG path data for grid lines at `step` covering the visible area. */
export function gridPath(v: View, size: Size, step: number, skip?: number): string {
  const [x0, y1] = screenToWorld(v, size, 0, 0);
  const [x1, y0] = screenToWorld(v, size, size.width, size.height);
  const parts: string[] = [];
  const onSkip = (k: number) =>
    skip !== undefined && Math.abs(k * step - Math.round((k * step) / skip) * skip) < step * 1e-6;
  const iStart = Math.ceil(x0 / step);
  const iEnd = Math.floor(x1 / step);
  if (iEnd - iStart > 2000) return '';
  for (let i = iStart; i <= iEnd; i++) {
    if (onSkip(i)) continue;
    const sx = Math.round(worldToScreen(v, size, i * step, 0)[0]) + 0.5;
    parts.push(`M${sx} 0V${size.height}`);
  }
  const jStart = Math.ceil(y0 / step);
  const jEnd = Math.floor(y1 / step);
  if (jEnd - jStart > 2000) return '';
  for (let j = jStart; j <= jEnd; j++) {
    if (onSkip(j)) continue;
    const sy = Math.round(worldToScreen(v, size, 0, j * step)[1]) + 0.5;
    parts.push(`M0 ${sy}H${size.width}`);
  }
  return parts.join('');
}

/** Format a coordinate for display with precision suited to the zoom level. */
export function formatCoord(value: number, scale: number): string {
  const decimals = Math.max(0, Math.min(6, Math.ceil(Math.log10(scale)) + 1));
  const s = value.toFixed(decimals);
  return s === '-' + (0).toFixed(decimals) ? (0).toFixed(decimals) : s;
}
