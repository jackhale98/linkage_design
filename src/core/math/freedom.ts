// Local freedom of a point: how it can still move under the constraints.

type Vec = [number, number];

export interface PointFreedom {
  /** 'line': can slide one way only (dir); 'plane': can move in any direction. */
  kind: 'line' | 'plane';
  /** Main direction of motion (unit). */
  dir: Vec;
}

/**
 * Freedom of one point from its velocity under each vector of an orthonormal
 * null-space basis. The spread of those velocities (a 2x2 covariance) is
 * basis-independent: rank 0 = fixed, rank 1 = slides along a line, rank 2 =
 * free in the plane. `tol` is the smallest speed that counts as motion.
 */
export function pointFreedom(samples: Vec[], tol = 1e-6): PointFreedom | null {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const [x, y] of samples) {
    a += x * x;
    b += x * y;
    c += y * y;
  }
  const half = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const l1 = (a + c) / 2 + half;
  const l2 = (a + c) / 2 - half;
  if (l1 <= tol * tol) return null;
  let dir: Vec = Math.abs(b) > 1e-12 * l1 ? [l1 - c, b] : a >= c ? [1, 0] : [0, 1];
  const n = Math.hypot(dir[0], dir[1]);
  dir = [dir[0] / n, dir[1] / n];
  return { kind: l2 > 1e-6 * l1 && l2 > tol * tol ? 'plane' : 'line', dir };
}
