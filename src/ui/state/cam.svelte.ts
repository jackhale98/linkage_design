// Cam workspace state: the analysis, playback (the cam turning), plot
// choices and edits to the cam data.

import { analyzeCam, type CamAnalysis } from '../../core/cam/analysis';
import type { MotionLaw } from '../../core/cam/laws';
import {
  emptyCam,
  isOscillating,
  starterProgram,
  type CamData,
  type CamSegment,
  type SegmentType,
} from '../../core/cam/types';
import { store } from './project.svelte';
import { toasts } from './toasts.svelte';

/** Seconds per cam revolution at the auto playback pace. */
export const CAM_AUTO_REV_S = 6;

export type CamPlotKey = 's' | 'v' | 'a' | 'j' | 'pressure' | 'rhoPitch' | 'rhoSurface' | 'force' | 'torque';

class CamUi {
  /** Cam angle shown (degrees). */
  angle = $state(0);
  playing = $state(false);
  /** Multiple of real time, or 0 for auto (one revolution every CAM_AUTO_REV_S). */
  playbackSpeed = $state(0);
  xAxis = $state<'angle' | 'time'>('angle');
  plotKeys = $state<CamPlotKey[]>(['s', 'v', 'a', 'j']);
  selectedSegment = $state<string | null>(null);

  analysis: CamAnalysis = $derived.by(() =>
    analyzeCam(store.project.cam, {
      length: store.project.meta.length_unit,
      force: store.project.meta.force_unit,
    }),
  );

  #raf = 0;
  #last = 0;

  /** The analysis sample nearest the shown angle. */
  get sampleIndex(): number {
    const n = this.analysis.samples.length;
    return n ? Math.round((((this.angle % 360) + 360) % 360) / (360 / n)) % n : -1;
  }

  play(): void {
    if (!this.analysis.ok) return;
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

  #tick = (now: number) => {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;
    const degPerS =
      this.playbackSpeed > 0 ? store.project.cam.speed * 6 * this.playbackSpeed : 360 / CAM_AUTO_REV_S;
    this.angle = (this.angle + degPerS * dt) % 360;
    this.#raf = requestAnimationFrame(this.#tick);
  };

  /** Bounding box of the cam and follower over a revolution (for fitting the view). */
  extents(): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
    const a = this.analysis;
    const cam = store.project.cam;
    if (!a.ok) return undefined;
    const R = Math.max(...a.samples.map((x) => Math.hypot(...x.surface)));
    const follower = isOscillating(cam.follower)
      ? {
          minX: Math.min(-R, cam.pivotDistance - cam.armLength),
          maxX: Math.max(R, cam.pivotDistance),
          maxY: R + cam.rollerRadius,
        }
      : { minX: -R, maxX: R, maxY: cam.baseRadius + a.summary.lift + 2 * cam.rollerRadius + R * 0.9 };
    const pad = R * 0.15;
    return {
      minX: follower.minX - pad,
      minY: -R - pad,
      maxX: follower.maxX + pad,
      maxY: follower.maxY + pad,
    };
  }

  togglePlot(key: CamPlotKey): void {
    this.plotKeys = this.plotKeys.includes(key)
      ? this.plotKeys.filter((k) => k !== key)
      : [...this.plotKeys, key];
  }

  // ------------------------------------------------------------ edits

  set(patch: Partial<CamData>): void {
    store.update((p) => {
      const next = { ...p.cam, ...patch };
      // Switching between translating and oscillating changes what a lift means.
      if (patch.follower && isOscillating(patch.follower) !== isOscillating(p.cam.follower))
        toasts.show(
          isOscillating(patch.follower)
            ? 'Lifts are now arm angles in degrees'
            : `Lifts are now lengths in ${p.meta.length_unit}`,
          'info',
        );
      p.cam = next;
    });
  }

  start(): void {
    store.update((p) => {
      p.cam = { ...emptyCam(), ...p.cam, segments: starterProgram() };
    });
  }

  setSegment(id: string, patch: Partial<CamSegment>): void {
    store.update((p) => {
      const s = p.cam.segments.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    });
  }

  addSegment(type: SegmentType): void {
    let id = '';
    store.update((p) => {
      let k = 1;
      while (p.cam.segments.some((s) => s.id === `S${k}`)) k++;
      id = `S${k}`;
      const used = p.cam.segments.reduce((sum, s) => sum + s.duration, 0);
      const law: MotionLaw = p.cam.segments.find((s) => s.type !== 'dwell')?.law ?? 'cycloidal';
      p.cam.segments.push({
        id,
        type,
        duration: Math.max(0, Math.min(90, 360 - used)) || 30,
        lift: type === 'dwell' ? 0 : 10,
        law,
        extras: {},
      });
    });
    this.selectedSegment = id;
  }

  removeSegment(id: string): void {
    store.update((p) => {
      p.cam.segments = p.cam.segments.filter((s) => s.id !== id);
    });
  }

  moveSegment(id: string, by: -1 | 1): void {
    store.update((p) => {
      const i = p.cam.segments.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= p.cam.segments.length) return;
      const segs = p.cam.segments;
      [segs[i], segs[j]] = [segs[j]!, segs[i]!];
    });
  }
}

export const camUi = new CamUi();
