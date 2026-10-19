// Mechanism and Motion workspace state: derived kinematics, selection,
// animation playback and plot choices.

import * as medit from '../../core/mechanism/edit';
import { reachable, quantities, type Quantity } from '../../core/mechanism/analysis';
import { computeMotion, type MotionResult } from '../../core/mechanism/motion';
import type { Frame } from '../../core/mechanism/sweep';
import type { DriverSpec, JointType } from '../../core/mechanism/types';
import type { Project } from '../../core/model/project';
import type { CanvasPointer, PointerResult } from '../lib/canvasEvents';
import { worldToScreen } from '../lib/view';
import { store } from './project.svelte';
import { toasts } from './toasts.svelte';

type Vec = [number, number];

function plain(p: Project): Project {
  return $state.snapshot(p) as Project;
}

class MotionUi {
  /** Selected bodies and points (Mechanism/Motion workspaces). */
  selection = $state<string[]>([]);
  hover = $state<string | null>(null);

  /** Continuous playback position, an index into the reachable frames. */
  phase = $state(0);
  playing = $state(false);
  playbackSpeed = $state(1);
  showTraces = $state(true);
  showVelocity = $state(false);
  /** Plotted quantity keys, each with a fixed colour slot (colour follows the quantity). */
  plotKeys = $state<string[]>([]);
  plotSlots = $state<Record<string, number>>({});
  xAxis = $state<'input' | 'time'>('input');

  /** Kinematics for the current project (recomputed lazily when read). */
  result: MotionResult = $derived.by(() => computeMotion(plain(store.project)));
  frames: Frame[] = $derived(this.result.res ? reachable(this.result.res) : []);
  quantities: Quantity[] = $derived(
    this.result.data ? quantities(this.result.sys, this.result.data.units) : [],
  );

  #direction = 1;
  #raf = 0;
  #last = 0;

  get frameIndex(): number {
    const n = this.frames.length;
    if (n === 0) return -1;
    return Math.max(0, Math.min(n - 1, Math.round(this.phase)));
  }

  get frame(): Frame | null {
    const i = this.frameIndex;
    return i >= 0 ? this.frames[i]! : null;
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
    // Frames per second at real speed: |rate| / spacing between frames.
    const spacing = Math.abs(this.frames[1]!.t - this.frames[0]!.t) || 1;
    const fps = (Math.abs(data.rate) / spacing) * this.playbackSpeed;
    let p = this.phase + this.#direction * fps * dt;
    if (this.result.res?.fullRotation) {
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

  pointer(ev: CanvasPointer, pose: Map<string, Vec>): PointerResult {
    if (ev.type === 'leave') {
      this.hover = null;
      return;
    }
    if (ev.type === 'move') {
      this.hover = this.pick(ev, pose)?.id ?? null;
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
  ensureDefaultPlot(): void {
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

  setJointType(id: string, type: JointType): void {
    this.#edit((p) => medit.setJointType(p.sketch, p.mechanism, id, type));
  }

  setTrace(point: string, on: boolean): void {
    this.#edit((p) => medit.setTrace(p.mechanism, point, on));
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
