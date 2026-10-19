// Mechanism and Motion workspace state: derived kinematics, selection,
// animation playback and plot choices.

import * as medit from '../../core/mechanism/edit';
import { quantities, type CycleFrame, type Quantity } from '../../core/mechanism/analysis';
import { computeMotion, type MotionResult } from '../../core/mechanism/motion';
import { analyzeCam } from '../../core/cam/analysis';
import type { Attach } from '../../core/mechanism/kinematics';
import type { Frame } from '../../core/mechanism/sweep';
import type { DriverSpec, JointType, PairRecord, PairType } from '../../core/mechanism/types';
import { angleScale, type Project } from '../../core/model/project';
import { solveForces, barMassProperties, type ForceResult } from '../../core/forces/solve';
import { forceQuantities } from '../../core/forces/analysis';
import { newLoad, type Load, type LoadType, type ForcesData } from '../../core/forces/types';
import { GROUND } from '../../core/mechanism/types';
import type { CanvasPointer, PointerResult } from '../lib/canvasEvents';
import { worldToScreen } from '../lib/view';
import { store } from './project.svelte';
import { toasts } from './toasts.svelte';
import { ui } from './ui.svelte';

type Vec = [number, number];

function plain(p: Project): Project {
  return $state.snapshot(p) as Project;
}

/** A drag in progress: where it holds the mechanism, and the pose so far. */
interface Drag {
  attach: Attach;
  q: number[];
  sx: number;
  sy: number;
  moved: boolean;
}

/** Seconds per stroke (or revolution) at the auto playback pace. */
export const AUTO_PASS_S = 4;

class MotionUi {
  /** Selected bodies and points (Mechanism/Motion workspaces). */
  selection = $state<string[]>([]);
  hover = $state<string | null>(null);

  /** Continuous playback position, an index into the reachable frames. */
  phase = $state(0);
  playing = $state(false);
  /** Multiple of real time, or 0 for auto: one stroke (or revolution) every AUTO_PASS_S seconds. */
  playbackSpeed = $state(0);
  showTraces = $state(true);
  showVelocity = $state(false);
  /** Plotted quantity keys, each with a fixed colour slot (colour follows the quantity). */
  plotKeys = $state<string[]>([]);
  plotSlots = $state<Record<string, number>>({});
  xAxis = $state<'input' | 'time'>('input');

  /** Kinematics for the current project (recomputed lazily when read). */
  result: MotionResult = $derived.by(() => computeMotion(plain(store.project)));
  frames: CycleFrame[] = $derived(this.result.data?.frames ?? []);
  quantities: Quantity[] = $derived(
    this.result.data ? quantities(this.result.sys, this.result.data.units) : [],
  );

  /** Joint reactions and driver effort over the sweep (computed when read). */
  forces: ForceResult = $derived.by(() => {
    const p = store.project;
    return solveForces(
      this.result,
      $state.snapshot(p.mechanism.bodies) as Project['mechanism']['bodies'],
      $state.snapshot(p.forces) as Project['forces'],
      { length: p.meta.length_unit, force: p.meta.force_unit },
      angleScale(p),
    );
  });
  forceQuantities: Quantity[] = $derived(
    this.result.data
      ? forceQuantities(this.result.data, store.project.forces, this.forces, {
          force: store.project.meta.force_unit,
          length: store.project.meta.length_unit,
        })
      : [],
  );
  showReactions = $state(true);
  showLoads = $state(true);
  /** Load being edited in the Forces panel. */
  selectedLoad = $state<string | null>(null);
  /** Outlines (cam frame) of the cams mounted by cam joints. */
  camShapes: Map<string, [number, number][]> = $derived.by(() => {
    const used = new Set(store.project.mechanism.pairs.filter((x) => x.type === 'cam').map((x) => x.cam));
    const units = { length: store.project.meta.length_unit, force: store.project.meta.force_unit };
    return new Map(
      store.project.cams
        .filter((c) => used.has(c.id))
        .map(
          (c) => [c.id, analyzeCam(c, units).samples.map((x) => x.surface)] as [string, [number, number][]],
        ),
    );
  });
  /** Cam or gear joint open for editing in the Mechanism panel. */
  selectedPair = $state<string | null>(null);

  /** A pose dragged by hand where there's no sweep to follow (e.g. the Mechanism workspace). */
  testPose = $state.raw<{ result: MotionResult; q: number[] } | null>(null);
  #drag: Drag | null = null;

  /** Dragging moves along the sweep (Motion, Forces), rather than posing freely (Mechanism). */
  get followsSweep(): boolean {
    return (ui.workspace === 'motion' || ui.workspace === 'forces') && this.frames.length > 1;
  }

  /** The hand-dragged pose, if it belongs to the current mechanism. */
  get testQ(): number[] | null {
    return this.testPose && this.testPose.result === this.result ? this.testPose.q : null;
  }

  #direction = 1;
  #raf = 0;
  #last = 0;

  get frameIndex(): number {
    const n = this.frames.length;
    if (n === 0) return -1;
    return Math.max(0, Math.min(n - 1, Math.round(this.phase)));
  }

  get frame(): CycleFrame | null {
    const i = this.frameIndex;
    return i >= 0 ? this.frames[i]! : null;
  }

  /** The pose between sweep steps at the exact playback position (smooth animation). */
  get displayFrame(): CycleFrame | null {
    const n = this.frames.length;
    if (n === 0) return null;
    const p = Math.max(0, Math.min(n - 1, this.phase));
    const i = Math.min(n - 2, Math.floor(p));
    const f = p - i;
    if (i < 0 || f < 1e-6) return this.frames[Math.round(p)]!;
    const a = this.frames[i]!;
    const b = this.frames[i + 1]!;
    if (f > 1 - 1e-6) return b;
    const lerp = (x: number[], y: number[]) => x.map((v, k) => v + (y[k]! - v) * f);
    return {
      t: a.t + (b.t - a.t) * f,
      q: lerp(a.q, b.q),
      qd: lerp(a.qd, b.qd),
      qdd: lerp(a.qdd, b.qdd),
      dir: f < 0.5 ? a.dir : b.dir,
      time: a.time + (b.time - a.time) * f,
    };
  }

  /** Positions of every mechanism point at a frame (null = the drawn pose). */
  poseAt(frame: Frame | null): Map<string, Vec> {
    const { model, sys } = this.result;
    // A fresh value per call, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const out = new Map<string, Vec>(model.positions);
    if (!frame) return out;
    for (const b of model.bodies) for (const p of b.points) out.set(p, sys.pos(frame.q, sys.attach(p, b.id)));
    return out;
  }

  /** Positions of every mechanism point at body coordinates q. */
  poseAtQ(q: number[]): Map<string, Vec> {
    const { model, sys } = this.result;
    // A fresh value per call, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const out = new Map<string, Vec>(model.positions);
    for (const b of model.bodies) for (const p of b.points) out.set(p, sys.pos(q, sys.attach(p, b.id)));
    return out;
  }

  /** Move the playback position to where the driver input is t (nearest the current position). */
  seekInput(t: number): void {
    const fr = this.frames;
    const n = fr.length;
    if (n < 2) return;
    const rotary = this.result.sys.driver?.type === 'rotary';
    const cur = this.frame?.t ?? fr[0]!.t;
    const tt = rotary ? t + Math.round((cur - t) / (2 * Math.PI)) * 2 * Math.PI : t;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < n - 1; k++) {
      const a = fr[k]!.t;
      const b = fr[k + 1]!.t;
      if (a === b || (tt - a) * (tt - b) > 0) continue;
      const p = k + (tt - a) / (b - a);
      const d = Math.abs(p - this.phase);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best < 0) {
      // Outside the swept range: go to the nearer end.
      best = Math.abs(fr[0]!.t - tt) <= Math.abs(fr[n - 1]!.t - tt) ? 0 : n - 1;
      if (this.result.data?.cycle)
        best = Math.abs(fr[0]!.t - tt) <= Math.abs(fr[(n - 1) / 2]!.t - tt) ? 0 : (n - 1) / 2;
    }
    this.phase = best;
  }

  /** Paths of the traced points across all reachable frames. */
  tracePaths(): { point: string; color: string; path: Vec[] }[] {
    const { model, sys } = this.result;
    return store.project.mechanism.motion.trace.flatMap((p) => {
      const body = model.pointBodies.get(p)?.[0];
      if (!body || model.groundPoints.has(p)) return [];
      const a = sys.attach(p, body);
      const color = model.bodies.find((b) => b.id === body)!.color;
      return [{ point: p, color, path: this.frames.map((f) => sys.pos(f.q, a)) }];
    });
  }

  /** Bounding box of every mechanism point over the whole sweep (for fitting the view). */
  extents(): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
    const { model, sys } = this.result;
    if (!model.bodies.length) return undefined;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const add = ([x, y]: Vec) => {
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    };
    for (const p of model.positions.values()) add(p);
    for (const f of this.frames)
      for (const b of model.bodies) for (const p of b.points) add(sys.pos(f.q, sys.attach(p, b.id)));
    const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * 0.08;
    return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
  }

  // ------------------------------------------------------------ playback

  play(): void {
    if (this.frames.length < 2) return;
    this.playing = true;
    this.#last = performance.now();
    cancelAnimationFrame(this.#raf);
    this.#raf = requestAnimationFrame(this.#tick);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.#raf);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(index: number): void {
    this.phase = Math.max(0, Math.min(this.frames.length - 1, index));
  }

  #tick = (now: number) => {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;
    const n = this.frames.length;
    const data = this.result.data;
    if (n < 2 || !data) {
      this.pause();
      return;
    }
    // Frames per second: auto paces one stroke (or revolution) per AUTO_PASS_S;
    // otherwise a multiple of real time, |rate| / spacing between frames.
    const spacing = Math.abs(this.frames[1]!.t - this.frames[0]!.t) || 1;
    const fps =
      this.playbackSpeed > 0
        ? (Math.abs(data.rate) / spacing) * this.playbackSpeed
        : (n - 1) / (data.cycle ? 2 * AUTO_PASS_S : AUTO_PASS_S);
    let p = this.phase + this.#direction * fps * dt;
    if (this.result.res?.fullRotation || data.cycle) {
      // The last frame repeats the first: wrap over n - 1 frames.
      const m = n - 1;
      p = ((p % m) + m) % m;
    } else if (p >= n - 1) {
      p = 2 * (n - 1) - p;
      this.#direction = -1;
    } else if (p <= 0) {
      p = -p;
      this.#direction = 1;
    }
    this.phase = Math.max(0, Math.min(n - 1, p));
    this.#raf = requestAnimationFrame(this.#tick);
  };

  // ------------------------------------------------------------ canvas

  /** Pick a mechanism point or link under the cursor (points first). */
  pick(ev: CanvasPointer, pose: Map<string, Vec>): { kind: 'point' | 'body'; id: string } | null {
    const { model } = this.result;
    const S = (p: Vec) => worldToScreen(ev.view, ev.size, p[0], p[1]);
    let best: { kind: 'point' | 'body'; id: string } | null = null;
    let bestD = 9;
    const points = new Set([...model.bodies.flatMap((b) => b.points)]);
    for (const id of points) {
      const s = S(pose.get(id)!);
      const d = Math.hypot(s[0] - ev.sx, s[1] - ev.sy);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'point', id };
      }
    }
    if (best) return best;
    bestD = 9;
    for (const b of model.bodies) {
      for (const l of b.lines) {
        const [p1, p2] = model.lineEnds.get(l)!;
        const a = S(pose.get(p1)!);
        const c = S(pose.get(p2)!);
        const dx = c[0] - a[0];
        const dy = c[1] - a[1];
        const t = Math.max(
          0,
          Math.min(1, ((ev.sx - a[0]) * dx + (ev.sy - a[1]) * dy) / Math.max(dx * dx + dy * dy, 1e-9)),
        );
        const d = Math.hypot(a[0] + t * dx - ev.sx, a[1] + t * dy - ev.sy);
        if (d < bestD) {
          bestD = d;
          best = { kind: 'body', id: b.id };
        }
      }
    }
    return best;
  }

  /** Where a drag takes hold: the point picked, or the spot on the link under the cursor. */
  grab(hit: { kind: 'point' | 'body'; id: string }, ev: CanvasPointer): Drag | null {
    const { sys, model } = this.result;
    const q = this.followsSweep ? (this.displayFrame?.q ?? sys.q0()) : (this.testQ ?? sys.q0());
    let attach: Attach | null = null;
    if (hit.kind === 'point') {
      const body = model.groundPoints.has(hit.id) ? undefined : model.pointBodies.get(hit.id)?.[0];
      if (body) attach = sys.attach(hit.id, body);
    } else {
      const i = sys.bodyIndex.get(hit.id);
      if (i !== undefined) {
        const phi = q[3 * i + 2]!;
        const dx = ev.wx - q[3 * i]!;
        const dy = ev.wy - q[3 * i + 1]!;
        attach = {
          body: i,
          s: [Math.cos(phi) * dx + Math.sin(phi) * dy, -Math.sin(phi) * dx + Math.cos(phi) * dy],
        };
      }
    }
    return attach ? { attach, q: q.slice(), sx: ev.sx, sy: ev.sy, moved: false } : null;
  }

  pointer(ev: CanvasPointer, pose: Map<string, Vec>): PointerResult {
    if (ev.type === 'leave') {
      this.hover = null;
      return;
    }
    if (ev.type === 'move') {
      const drag = this.#drag;
      if (drag) {
        if (!drag.moved && Math.hypot(ev.sx - drag.sx, ev.sy - drag.sy) < 4) return;
        drag.moved = true;
        this.pause();
        const { sys } = this.result;
        drag.q = sys.dragTo(drag.q, drag.attach, [ev.wx, ev.wy]);
        if (this.followsSweep) {
          const t = sys.inputAt(drag.q);
          if (t !== null) this.seekInput(t);
        } else this.testPose = { result: this.result, q: drag.q };
        return;
      }
      this.hover = this.pick(ev, pose)?.id ?? null;
      return;
    }
    if (ev.type === 'up') {
      this.#drag = null;
      return;
    }
    if (ev.type === 'tap') {
      if (!ev.shift) this.selection = [];
      return;
    }
    if (ev.type !== 'down') return;
    if (ev.button !== 0) return 'pan';
    const hit = this.pick(ev, pose);
    if (!hit) return 'pan';
    if (ev.shift) {
      this.selection = this.selection.includes(hit.id)
        ? this.selection.filter((x) => x !== hit.id)
        : [...this.selection, hit.id];
    } else {
      this.selection = [hit.id];
      this.#drag = this.grab(hit, ev);
    }
    return 'handled';
  }

  // ------------------------------------------------------------ plots

  togglePlot(key: string): void {
    if (this.plotKeys.includes(key)) {
      this.plotKeys = this.plotKeys.filter((k) => k !== key);
      const { [key]: _drop, ...rest } = this.plotSlots;
      this.plotSlots = rest;
      return;
    }
    if (this.plotKeys.length >= 8) {
      toasts.show('Up to 8 quantities can be plotted at once', 'info');
      return;
    }
    const used = new Set(Object.values(this.plotSlots));
    let slot = 0;
    while (used.has(slot)) slot++;
    this.plotKeys = [...this.plotKeys, key];
    this.plotSlots = { ...this.plotSlots, [key]: slot };
  }

  /** Default plot: the first traced point's speed, else the first link's angle. */
  #effortPlotted = false;
  #outputPlotted = false;

  ensureDefaultPlot(forces = false): void {
    // The first visit to the Forces plots shows the input torque or force.
    if (forces && !this.#outputPlotted && this.forceQuantities.some((q) => q.key === 'd:output')) {
      this.#outputPlotted = true;
      if (!this.plotKeys.includes('d:output')) this.togglePlot('d:output');
      return;
    }
    if (forces && !this.#effortPlotted && this.forceQuantities.length) {
      this.#effortPlotted = true;
      if (!this.plotKeys.some((k) => /^[dfsm]:/.test(k))) this.togglePlot('d:effort');
      return;
    }
    if (this.plotKeys.length || !this.quantities.length) return;
    const trace = store.project.mechanism.motion.trace[0];
    const key =
      (trace && this.quantities.find((q) => q.key === `p:${trace}:v`)?.key) ??
      this.quantities.find((q) => q.key.startsWith('b:'))?.key;
    if (key) this.togglePlot(key);
  }

  // ------------------------------------------------------------ edits

  #edit(fn: (p: Project) => boolean, failure?: string): boolean {
    const ok = store.tryUpdate(fn);
    if (!ok && failure) toasts.show(failure, 'warning');
    return ok;
  }

  merge(ids = this.selection): void {
    if (
      this.#edit((p) => medit.mergeBodies(p.sketch, p.mechanism, ids), 'Select two or more links to merge')
    ) {
      this.selection = [ids[0]!];
    }
  }

  split(id: string): void {
    this.#edit((p) => medit.splitBody(p.sketch, p.mechanism, id));
  }

  updateBody(id: string, patch: Partial<{ name: string; color: string; ground: boolean }>): void {
    if ('name' in patch)
      store.update((p) => void medit.updateBody(p.sketch, p.mechanism, id, patch), `body:${id}:name`);
    else this.#edit((p) => medit.updateBody(p.sketch, p.mechanism, id, patch));
  }

  setDriver(patch: Partial<DriverSpec>): void {
    this.pause();
    store.update((p) => medit.setDriver(p.sketch, p.mechanism, patch));
    this.phase = 0;
  }

  // ------------------------------------------------------------ cam and gear joints

  /** Add a cam joint, gear pair or rack and pinion, guessing sensible links and points. */
  addPair(type: PairType): void {
    const { model } = this.result;
    const project = store.project;
    if (type === 'cam' && !project.cams.length) {
      toasts.show('Design a cam in the Cam workspace first', 'info');
      return;
    }
    const groundPivots = model.joints
      .filter((j) => j.type === 'revolute' && (j.a === GROUND || j.b === GROUND))
      .map((j) => ({ body: j.a === GROUND ? j.b : j.a, point: j.point }));
    const d = model.driver;
    const prefix = type === 'cam' ? 'K' : type === 'gear' ? 'G' : 'R';
    let k = 1;
    while (project.mechanism.pairs.some((x) => x.id === `${prefix}${k}`)) k++;
    const rec: PairRecord = {
      id: `${prefix}${k}`,
      type,
      bodyA: '',
      pointA: '',
      bodyB: '',
      pointB: '',
      line: '',
      cam: type === 'cam' ? project.cams[0]!.id : '',
      teethA: 20,
      teethB: type === 'gear' ? 40 : 20,
      pressure: 20,
      extras: {},
    };
    const driven = d?.type === 'rotary' ? groundPivots.find((g) => g.body === d.body) : undefined;
    const first = driven ?? groundPivots[0];
    if (first) {
      rec.bodyA = first.body;
      rec.pointA = first.point;
    }
    if (type === 'gear') {
      const other = groundPivots.find((g) => g.body !== rec.bodyA);
      if (other) {
        rec.bodyB = other.body;
        rec.pointB = other.point;
      }
    } else if (type === 'rack') {
      const slid = model.joints.find((j) => j.type !== 'revolute' && j.b !== rec.bodyA && j.a !== rec.bodyA);
      const rack = slid ? (slid.a === GROUND ? slid.b : slid.a) : undefined;
      const body = model.bodies.find((b) => b.id === rack);
      if (body) {
        rec.bodyB = body.id;
        rec.line = body.lines[0] ?? '';
      }
    } else if (first) {
      // Roller: the nearest point of another link to the cam centre.
      const c = model.positions.get(first.point)!;
      let best = Infinity;
      for (const b of model.bodies) {
        if (b.id === rec.bodyA) continue;
        for (const pt of b.points) {
          const q = model.positions.get(pt)!;
          const dist = Math.hypot(q[0] - c[0], q[1] - c[1]);
          if (dist > 0 && dist < best) {
            best = dist;
            rec.bodyB = b.id;
            rec.pointB = pt;
          }
        }
      }
    }
    store.update((p) => {
      p.mechanism.pairs.push(rec);
    });
    this.selectedPair = rec.id;
  }

  updatePair(id: string, patch: Partial<PairRecord>): void {
    store.update((p) => {
      const r = p.mechanism.pairs.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
  }

  removePair(id: string): void {
    store.update((p) => {
      p.mechanism.pairs = p.mechanism.pairs.filter((x) => x.id !== id);
    });
  }

  setJointType(id: string, type: JointType): void {
    this.#edit((p) => medit.setJointType(p.sketch, p.mechanism, id, type));
  }

  setTrace(point: string, on: boolean): void {
    this.#edit((p) => medit.setTrace(p.mechanism, point, on));
  }

  // ------------------------------------------------------------ forces

  setAnalysis(
    patch: Partial<
      Pick<
        ForcesData,
        'mode' | 'gravity' | 'solveFor' | 'input' | 'outputJoint' | 'inputPoint' | 'outputPoint'
      >
    >,
  ): void {
    store.update((p) => Object.assign(p.forces, patch));
  }

  setMass(id: string, patch: Partial<{ mass: number; comX: number; comY: number; inertia: number }>): void {
    store.update(
      (p) => {
        const b = p.mechanism.bodies.find((x) => x.id === id);
        if (b) Object.assign(b, patch);
      },
      `mass:${id}:${Object.keys(patch).join()}`,
    );
  }

  /** Mass properties of every link as uniform bars with this mass per unit length. */
  estimateMasses(massPerLength: number): void {
    store.update((p) => {
      const ends = new Map(p.sketch.lines.map((l) => [l.id, [l.p1, l.p2] as [string, string]]));
      const pos = new Map(p.sketch.points.map((q) => [q.id, [q.x, q.y] as [number, number]]));
      const r = (v: number) => Number(v.toPrecision(6));
      for (const b of p.mechanism.bodies) {
        const m = barMassProperties(b, ends, pos, massPerLength);
        Object.assign(b, { mass: r(m.mass), comX: r(m.comX), comY: r(m.comY), inertia: r(m.inertia) });
      }
    });
  }

  addLoad(type: LoadType): void {
    const { model } = this.result;
    const sel = this.selection;
    const selBody = sel.find((id) => model.bodies.some((b) => b.id === id));
    const selPoints = sel.filter((id) => model.positions.has(id));
    const firstBody = model.bodies[0];
    const loads = store.project.forces.loads;
    let n = 0;
    for (const l of loads) {
      const m = /^[A-Z](\d+)$/.exec(l.id);
      if (m) n = Math.max(n, Number(m[1]));
    }
    const id = `${{ force: 'F', torque: 'T', spring: 'S', torsion: 'K' }[type]}${n + 1}`;
    const load: Load = newLoad(id, type);
    if (type === 'force') {
      const point = selPoints[0] ?? firstBody?.points[firstBody.points.length - 1] ?? '';
      load.point = point;
      load.body =
        (selBody && model.bodies.find((b) => b.id === selBody)?.points.includes(point)
          ? selBody
          : undefined) ??
        model.pointBodies.get(point)?.[0] ??
        '';
      load.fy = store.project.meta.force_unit === 'N' ? -100 : -20;
    } else if (type === 'torque') {
      load.body = selBody ?? firstBody?.id ?? '';
      load.torque = 1000;
    } else if (type === 'spring') {
      const pts = [
        ...new Set([...selPoints, ...model.bodies.flatMap((b) => b.points), ...model.groundPoints]),
      ];
      load.point = pts[0] ?? '';
      load.pointB =
        pts.find(
          (p) =>
            p !== load.point &&
            (model.groundPoints.has(p) ||
              !model.pointBodies.get(p)?.some((b) => model.pointBodies.get(load.point)?.includes(b))),
        ) ??
        pts[1] ??
        '';
      load.k = 1;
    } else {
      const j =
        model.joints.find((x) => x.type === 'revolute' && x.a !== GROUND && x.b !== GROUND) ??
        model.joints.find((x) => x.type === 'revolute');
      load.joint = j?.id ?? '';
      load.k = 100;
    }
    store.update((p) => void p.forces.loads.push(load));
    this.selectedLoad = id;
  }

  updateLoad(id: string, patch: Partial<Load>): void {
    store.update(
      (p) => {
        const l = p.forces.loads.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      },
      `load:${id}:${Object.keys(patch).join()}`,
    );
  }

  deleteLoad(id: string): void {
    store.update((p) => void (p.forces.loads = p.forces.loads.filter((l) => l.id !== id)));
    if (this.selectedLoad === id) this.selectedLoad = null;
  }

  /** Make a sketch dimension the driver. */
  useDimensionAsDriver(constraintId: string): boolean {
    const c = store.project.sketch.constraints.find((x) => x.id === constraintId);
    const spec = c && medit.driverFromDimension(store.project.sketch, c);
    if (!spec) {
      toasts.show('Only angles and distances can drive a mechanism', 'warning');
      return false;
    }
    this.setDriver(spec);
    return true;
  }
}

export const motionUi = new MotionUi();
