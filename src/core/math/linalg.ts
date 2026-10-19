// Dense linear algebra for the small systems in this app (tens to a few
// hundred unknowns). Plain arrays; clarity over speed.

export type Matrix = number[][];
export type Vector = number[];

/** Solve the square system A x = b with partial pivoting. Returns null if singular. Does not modify inputs. */
export function solveSquare(A: Matrix, b: Vector): Vector | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    const pivot = M[p]![c]!;
    if (Math.abs(pivot) < 1e-300) return null;
    if (p !== c) [M[c], M[p]] = [M[p]!, M[c]!];
    const rowC = M[c]!;
    for (let r = c + 1; r < n; r++) {
      const rowR = M[r]!;
      const f = rowR[c]! / pivot;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) rowR[k]! -= f * rowC[k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = M[r]!;
    let s = row[n]!;
    for (let k = r + 1; k < n; k++) s -= row[k]! * x[k]!;
    x[r] = s / row[r]!;
  }
  return x;
}

/**
 * Minimum-norm solution of J x = r (J is m x n, usually m <= n):
 * x = J^T (J J^T + delta I)^-1 r. The damping keeps it defined when rows
 * are dependent (redundant constraints).
 */
export function solveMinNorm(J: Matrix, r: Vector, delta = 1e-12): Vector {
  const m = J.length;
  const n = m ? J[0]!.length : 0;
  const A: Matrix = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  let diag = 0;
  for (let i = 0; i < m; i++) {
    const Ji = J[i]!;
    for (let j = i; j < m; j++) {
      const Jj = J[j]!;
      let s = 0;
      for (let k = 0; k < n; k++) s += Ji[k]! * Jj[k]!;
      A[i]![j] = s;
      A[j]![i] = s;
    }
    diag = Math.max(diag, A[i]![i]!);
  }
  const d = delta * Math.max(diag, 1);
  for (let i = 0; i < m; i++) A[i]![i]! += d;
  const y = solveSquare(A, r) ?? new Array<number>(m).fill(0);
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    const Ji = J[i]!;
    const yi = y[i]!;
    if (yi === 0) continue;
    for (let k = 0; k < n; k++) x[k]! += Ji[k]! * yi;
  }
  return x;
}

/**
 * Damped least squares (Levenberg-Marquardt step): x = (J^T J + mu I)^-1 J^T r.
 */
export function solveDamped(J: Matrix, r: Vector, mu: number): Vector {
  const m = J.length;
  const n = m ? J[0]!.length : 0;
  const A: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const g = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    const Ji = J[i]!;
    const ri = r[i]!;
    for (let a = 0; a < n; a++) {
      const v = Ji[a]!;
      if (v === 0) continue;
      g[a]! += v * ri;
      const Aa = A[a]!;
      for (let b = a; b < n; b++) Aa[b]! += v * Ji[b]!;
    }
  }
  for (let a = 0; a < n; a++) {
    A[a]![a]! += mu;
    for (let b = 0; b < a; b++) A[a]![b] = A[b]![a]!;
  }
  return solveSquare(A, g) ?? new Array<number>(n).fill(0);
}

/**
 * Incremental row-space basis (modified Gram-Schmidt). `add` returns false
 * when the row is (numerically) a combination of rows already added.
 */
export class RowSpace {
  readonly basis: Vector[] = [];

  constructor(private readonly tol = 1e-8) {}

  add(row: Vector): boolean {
    const norm0 = Math.hypot(...row);
    if (norm0 === 0) return false;
    const v = row.slice();
    for (const b of this.basis) {
      let dot = 0;
      for (let k = 0; k < v.length; k++) dot += v[k]! * b[k]!;
      if (dot !== 0) for (let k = 0; k < v.length; k++) v[k]! -= dot * b[k]!;
    }
    const norm = Math.hypot(...v);
    if (norm <= this.tol * norm0) return false;
    this.basis.push(v.map((x) => x / norm));
    return true;
  }
}

/**
 * Columns (variables) of J that are fixed by the constraints: a variable is
 * free if some null-space vector of J has a non-zero component on it.
 * Returns the null-space dimension and a per-column "free" flag.
 */
export function nullSpaceFreedom(J: Matrix, n: number, tol = 1e-9): { dim: number; free: boolean[] } {
  const M = J.map((r) => r.slice());
  const m = M.length;
  let scale = 0;
  for (const row of M) for (const v of row) scale = Math.max(scale, Math.abs(v));
  const eps = tol * Math.max(scale, 1);
  const pivotCols: number[] = [];
  let r = 0;
  for (let c = 0; c < n && r < m; c++) {
    let p = r;
    for (let i = r + 1; i < m; i++) if (Math.abs(M[i]![c]!) > Math.abs(M[p]![c]!)) p = i;
    if (Math.abs(M[p]![c]!) <= eps) continue;
    if (p !== r) [M[r], M[p]] = [M[p]!, M[r]!];
    const rowR = M[r]!;
    const piv = rowR[c]!;
    for (let k = c; k < n; k++) rowR[k]! /= piv;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const rowI = M[i]!;
      const f = rowI[c]!;
      if (f === 0) continue;
      for (let k = c; k < n; k++) rowI[k]! -= f * rowR[k]!;
    }
    pivotCols.push(c);
    r++;
  }
  const isPivot = new Array<boolean>(n).fill(false);
  pivotCols.forEach((c) => (isPivot[c] = true));
  const free = new Array<boolean>(n).fill(false);
  // Null-space basis: one vector per non-pivot column f, with 1 at f and
  // -M[row][f] at each pivot column.
  for (let f = 0; f < n; f++) {
    if (isPivot[f]) continue;
    free[f] = true;
    pivotCols.forEach((pc, row) => {
      if (Math.abs(M[row]![f]!) > 1e-7) free[pc] = true;
    });
  }
  return { dim: n - pivotCols.length, free };
}

export function normInf(v: Vector): number {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  return m;
}
