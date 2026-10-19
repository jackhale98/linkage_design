// Cam motion laws, normalised: u in [0, 1] (fraction of the segment), y in
// [0, 1] (fraction of the lift). Each law gives y and its first three
// derivatives with respect to u. A segment of duration beta (rad) and lift h
// then has s = h y(theta / beta), s' = h y' / beta, s'' = h y'' / beta^2, ...

export const MOTION_LAWS = [
  'constant_velocity',
  'simple_harmonic',
  'cycloidal',
  'modified_trapezoidal',
  'modified_sine',
  'poly_345',
  'poly_4567',
] as const;
export type MotionLaw = (typeof MOTION_LAWS)[number];

export const LAW_NAMES: Record<MotionLaw, string> = {
  constant_velocity: 'Constant velocity',
  simple_harmonic: 'Simple harmonic',
  cycloidal: 'Cycloidal',
  modified_trapezoidal: 'Modified trapezoidal',
  modified_sine: 'Modified sine',
  poly_345: '3-4-5 polynomial',
  poly_4567: '4-5-6-7 polynomial',
};

/** y, y', y'', y''' at u. */
export type LawValue = [number, number, number, number];

const PI = Math.PI;

/**
 * Laws defined by their acceleration shape: pieces of constant or sinusoidal
 * acceleration, integrated exactly from rest, then scaled so y(1) = 1.
 */
interface Piece {
  u0: number;
  u1: number;
  /** acc = k (const) or k sin(w (u - u0) + ph) (sine). */
  kind: 'const' | 'sine';
  k: number;
  w: number;
  ph: number;
}

interface Integrated extends Piece {
  v0: number; // y' at u0
  y0: number; // y at u0
}

function integrate(pieces: Piece[]): { segs: Integrated[]; scale: number } {
  const segs: Integrated[] = [];
  let v = 0;
  let y = 0;
  for (const p of pieces) {
    segs.push({ ...p, v0: v, y0: y });
    const e = evalPiece({ ...p, v0: v, y0: y }, p.u1);
    v = e[1];
    y = e[0];
  }
  return { segs, scale: 1 / y };
}

function evalPiece(p: Integrated, u: number): LawValue {
  const t = u - p.u0;
  if (p.kind === 'const') return [p.y0 + p.v0 * t + (p.k * t * t) / 2, p.v0 + p.k * t, p.k, 0];
  const a = p.w * t + p.ph;
  // acc = k sin(a); vel = v0 + k/w (cos ph - cos a); pos = y0 + v0 t + k/w (t cos ph - (sin a - sin ph)/w)
  const vel = p.v0 + (p.k / p.w) * (Math.cos(p.ph) - Math.cos(a));
  const pos = p.y0 + p.v0 * t + (p.k / p.w) * (t * Math.cos(p.ph) - (Math.sin(a) - Math.sin(p.ph)) / p.w);
  return [pos, vel, p.k * Math.sin(a), p.k * p.w * Math.cos(a)];
}

function pieceLaw(pieces: Piece[]): (u: number) => LawValue {
  const { segs, scale } = integrate(pieces);
  return (u) => {
    const p = segs.find((s) => u <= s.u1) ?? segs[segs.length - 1]!;
    const v = evalPiece(p, u);
    return [v[0] * scale, v[1] * scale, v[2] * scale, v[3] * scale];
  };
}

const sine = (u0: number, u1: number, w: number, ph: number, k = 1): Piece => ({
  u0,
  u1,
  kind: 'sine',
  k,
  w,
  ph,
});
const flat = (u0: number, u1: number, k: number): Piece => ({ u0, u1, kind: 'const', k, w: 0, ph: 0 });

// Modified trapezoidal: quarter-sine ramps (1/8 each) around constant
// acceleration plateaus (1/4 each).
const modTrap = pieceLaw([
  sine(0, 1 / 8, 4 * PI, 0),
  flat(1 / 8, 3 / 8, 1),
  sine(3 / 8, 5 / 8, 4 * PI, PI / 2),
  flat(5 / 8, 7 / 8, -1),
  sine(7 / 8, 1, 4 * PI, -PI / 2),
]);

// Modified sine: a quarter-sine (1/8) into a long half cosine (3/4) and back.
const modSine = pieceLaw([
  sine(0, 1 / 8, 4 * PI, 0),
  sine(1 / 8, 7 / 8, (4 * PI) / 3, PI / 2),
  sine(7 / 8, 1, 4 * PI, -PI / 2),
]);

export function law(name: MotionLaw, u: number): LawValue {
  switch (name) {
    case 'constant_velocity':
      return [u, 1, 0, 0];
    case 'simple_harmonic':
      return [
        (1 - Math.cos(PI * u)) / 2,
        (PI / 2) * Math.sin(PI * u),
        ((PI * PI) / 2) * Math.cos(PI * u),
        -((PI * PI * PI) / 2) * Math.sin(PI * u),
      ];
    case 'cycloidal':
      return [
        u - Math.sin(2 * PI * u) / (2 * PI),
        1 - Math.cos(2 * PI * u),
        2 * PI * Math.sin(2 * PI * u),
        4 * PI * PI * Math.cos(2 * PI * u),
      ];
    case 'modified_trapezoidal':
      return modTrap(u);
    case 'modified_sine':
      return modSine(u);
    case 'poly_345':
      return [
        u ** 3 * (10 - 15 * u + 6 * u * u),
        30 * u * u * (1 - u) ** 2,
        60 * u * (1 - 3 * u + 2 * u * u),
        60 * (1 - 6 * u + 6 * u * u),
      ];
    case 'poly_4567':
      return [
        u ** 4 * (35 - 84 * u + 70 * u * u - 20 * u ** 3),
        140 * u ** 3 * (1 - u) ** 3,
        420 * u * u * (1 - u) ** 2 * (1 - 2 * u),
        840 * u * (1 - u) * (1 - 5 * u + 5 * u * u),
      ];
  }
}
