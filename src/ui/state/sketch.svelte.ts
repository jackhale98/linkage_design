// Sketch workspace state and canvas interaction: tools, selection, snapping,
// drawing, dimensioning and dragging. Edits go through the project store so
// they are undoable, and through core/sketch/edit so they stay solvable.

import { angleScale } from '../../core/model/project';
import { syncMechanism } from '../../core/mechanism/model';
import { CONSTRAINT_DEFS, isDimension, refKinds } from '../../core/sketch/constraints';
import * as edit from '../../core/sketch/edit';
import { analyze, type SketchAnalysis, type SolverContext } from '../../core/sketch/solver';
import type { ConstraintType, Sketch, SketchConstraint } from '../../core/sketch/types';
import type { CanvasPointer, PointerResult } from '../lib/canvasEvents';
import {
  dimensionAnchor,
  hitTest,
  labelOffsetFor,
  layoutSketch,
  type Hit,
  type Layout,
} from '../lib/sketchLayout';
import * as storage from '../lib/storage';
import { gridSpacing, worldToScreen } from '../lib/view';
import { store } from './project.svelte';
import { toasts } from './toasts.svelte';

export type SketchTool = 'select' | 'pan' | 'point' | 'line' | 'dimension';

type Vec = [number, number];

/** Where a click lands: an existing point, a spot on a line, or open space. */
export type Snap =
  | { kind: 'point'; id: string; pos: Vec }
  | { kind: 'line'; id: string; pos: Vec }
  | { kind: 'free'; pos: Vec };

export interface LineDraft {
  start: Snap | null;
  end: Snap;
  infer: 'horizontal' | 'vertical' | null;
}

type Drag =
  | {
      kind: 'points';
      ids: string[];
      start: Vec;
      origin: Record<string, Vec>;
      moved: boolean;
      selectOnClick?: string;
    }
  | { kind: 'label'; id: string; start: Vec; moved: boolean; selectOnClick?: string };

const INFER_TAN = Math.tan((3 * Math.PI) / 180);
const DRAG_THRESHOLD_PX = 3;

function plain(sk: Sketch): Sketch {
  return $state.snapshot(sk) as Sketch;
}

class SketchUi {
  tool = $state<SketchTool>('select');
  selection = $state<string[]>([]);
  hover = $state<string | null>(null);
  gridSnap = $state(storage.load('gridSnap') !== 'false');
  /** Dimension whose value is being typed. */
  editing = $state<string | null>(null);
  /** Line tool preview. */
  draft = $state<LineDraft | null>(null);
  /** Point tool / dimension tool snap preview. */
  cursor = $state<Snap | null>(null);
  /** Entities picked so far with the dimension tool. */
  pending = $state<string[]>([]);

  ctx: SolverContext = $derived({ angleScale: angleScale(store.project) });
  analysis: SketchAnalysis = $derived.by(() => analyze(plain(store.project.sketch), this.ctx));

  #drag: Drag | null = null;

  // ------------------------------------------------------------ edits

  /**
   * Run an edit on a plain copy of the sketch and commit it as one undo step.
   * Refusals are shown as a toast and leave the project untouched.
   */
  apply(fn: (sk: Sketch) => edit.EditResult | boolean): boolean {
    let notes: string[] = [];
    let reason: string | undefined;
    const ok = store.tryUpdate((p) => {
      const sk = plain(p.sketch);
      const r = fn(sk);
      if (r === false || (typeof r === 'object' && !r.ok)) {
        if (typeof r === 'object' && !r.ok) reason = r.reason;
        return false;
      }
      if (typeof r === 'object' && r.ok) notes = r.notes;
      p.sketch = sk;
      syncMechanism(p.sketch, p.mechanism); // bodies and joints follow the sketch
      return true;
    });
    if (reason) toasts.show(reason, 'warning');
    for (const n of notes) toasts.show(n, 'info');
    return ok;
  }

  addConstraint(type: ConstraintType, refs = this.selection): string | undefined {
    let id: string | undefined;
    this.apply((sk) => {
      const r = edit.addConstraint(sk, { type, refs }, this.ctx);
      if (r.ok) id = r.id;
      return r;
    });
    if (id && isDimension({ type })) {
      this.selection = [id];
      const c = store.project.sketch.constraints.find((x) => x.id === id);
      if (c && !c.reference) this.editing = id;
    }
    return id;
  }

  setDimension(id: string, value: number): boolean {
    return this.apply((sk) => edit.setDimensionValue(sk, id, value, this.ctx));
  }

  setReference(id: string, reference: boolean): boolean {
    return this.apply((sk) => edit.setReference(sk, id, reference, this.ctx));
  }

  setFixed(id: string, fixed: boolean): boolean {
    return this.apply((sk) => edit.setFixed(sk, id, fixed, this.ctx));
  }

  setConstruction(id: string, construction: boolean): void {
    this.apply((sk) => {
      const l = sk.lines.find((x) => x.id === id);
      if (!l || l.construction === construction) return false;
      l.construction = construction;
      return true;
    });
  }

  setLabel(id: string, label: string): void {
    store.update((p) => {
      const pt = p.sketch.points.find((x) => x.id === id);
      if (pt) pt.label = label;
    }, `label:${id}`);
  }

  /** Move a point to typed coordinates (like a drag, so constraints still hold). */
  movePoint(id: string, x: number, y: number): void {
    this.apply((sk) => edit.dragPoints(sk, [{ point: id, x, y }], this.ctx));
  }

  deleteSelection(): void {
    if (this.selection.length === 0) return;
    const ids = this.selection.slice();
    if (this.apply((sk) => (edit.deleteEntities(sk, ids), edit.resolve(sk, this.ctx), true))) {
      this.selection = [];
      this.editing = null;
    }
  }

  selectAll(): void {
    const sk = store.project.sketch;
    this.selection = [...sk.points.map((p) => p.id), ...sk.lines.map((l) => l.id)];
  }

  toggleGridSnap(): void {
    this.gridSnap = !this.gridSnap;
    storage.save('gridSnap', String(this.gridSnap));
  }

  setTool(tool: SketchTool): void {
    this.tool = tool;
    this.draft = null;
    this.cursor = null;
    this.pending = [];
  }

  /** Esc: finish the current action, then leave the tool, then clear the selection. */
  escape(): boolean {
    if (this.draft?.start) {
      this.draft = { ...this.draft, start: null };
      return true;
    }
    if (this.pending.length) {
      this.pending = [];
      return true;
    }
    if (this.tool !== 'select') {
      this.setTool('select');
      return true;
    }
    if (this.selection.length) {
      this.selection = [];
      return true;
    }
    return false;
  }

  /** The selection as entity refs (points and lines only), for applying constraints. */
  get geometrySelection(): string[] {
    const kinds = refKinds(store.project.sketch, this.selection);
    return this.selection.filter((_, i) => kinds[i] !== undefined);
  }

  // ------------------------------------------------------------ canvas

  layoutFor(ev: CanvasPointer): Layout {
    return layoutSketch({
      sketch: store.project.sketch,
      analysis: this.analysis,
      view: ev.view,
      size: ev.size,
      angleUnit: store.project.meta.angle_unit,
      angleScale: this.ctx.angleScale,
    });
  }

  /** Resolve the snap target under the cursor. */
  snapAt(ev: CanvasPointer, exclude?: Set<string>): Snap {
    const hit = hitTest(this.layoutFor(ev), ev.sx, ev.sy, exclude, true);
    const sk = store.project.sketch;
    if (hit?.kind === 'point') {
      const p = sk.points.find((x) => x.id === hit.id)!;
      return { kind: 'point', id: p.id, pos: [p.x, p.y] };
    }
    if (hit?.kind === 'line') {
      const l = sk.lines.find((x) => x.id === hit.id)!;
      const a = sk.points.find((p) => p.id === l.p1)!;
      const b = sk.points.find((p) => p.id === l.p2)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = ((ev.wx - a.x) * dx + (ev.wy - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-24);
      return { kind: 'line', id: l.id, pos: [a.x + t * dx, a.y + t * dy] };
    }
    if (this.gridSnap && !ev.alt) {
      const step = gridSpacing(ev.view.scale).minor;
      return { kind: 'free', pos: [Math.round(ev.wx / step) * step, Math.round(ev.wy / step) * step] };
    }
    return { kind: 'free', pos: [ev.wx, ev.wy] };
  }

  /** Create (if needed) the point for a snap target inside an edit. Returns its ID. */
  #realize(sk: Sketch, snap: Snap): string | null {
    if (snap.kind === 'point') return snap.id;
    const id = edit.addPoint(sk, snap.pos[0], snap.pos[1]);
    if (snap.kind === 'line') {
      const r = edit.addConstraint(sk, { type: 'point_on_line', refs: [id, snap.id] }, this.ctx);
      if (!r.ok) return null;
    }
    return id;
  }

  #inferLine(start: Snap, end: Snap, ev: CanvasPointer): LineDraft {
    let e = end;
    let infer: LineDraft['infer'] = null;
    if (end.kind === 'free' && !ev.alt) {
      const dx = end.pos[0] - start.pos[0];
      const dy = end.pos[1] - start.pos[1];
      if (Math.abs(dy) <= INFER_TAN * Math.abs(dx)) {
        infer = 'horizontal';
        e = { kind: 'free', pos: [end.pos[0], start.pos[1]] };
      } else if (Math.abs(dx) <= INFER_TAN * Math.abs(dy)) {
        infer = 'vertical';
        e = { kind: 'free', pos: [start.pos[0], end.pos[1]] };
      }
    }
    return { start, end: e, infer };
  }

  pointer(ev: CanvasPointer): PointerResult {
    switch (this.tool) {
      case 'pan':
        return ev.type === 'down' ? 'pan' : undefined;
      case 'point':
        return this.#pointTool(ev);
      case 'line':
        return this.#lineTool(ev);
      case 'dimension':
        return this.#dimensionTool(ev);
      default:
        return this.#selectTool(ev);
    }
  }

  #pointTool(ev: CanvasPointer): PointerResult {
    if (ev.type === 'move') this.cursor = this.snapAt(ev);
    if (ev.type === 'leave') this.cursor = null;
    if (ev.type !== 'down' || ev.button !== 0) return ev.type === 'down' ? 'pan' : undefined;
    const snap = this.snapAt(ev);
    if (snap.kind === 'point') {
      this.selection = [snap.id];
      return 'handled';
    }
    let id: string | null = null;
    this.apply((sk) => {
      id = this.#realize(sk, snap);
      return id !== null;
    });
    if (id) this.selection = [id];
    return 'handled';
  }

  #lineTool(ev: CanvasPointer): PointerResult {
    const start = this.draft?.start ?? null;
    if (ev.type === 'leave') {
      if (!start) this.draft = null;
      return;
    }
    if (ev.type === 'move') {
      const end = this.snapAt(ev, start?.kind === 'point' ? new Set([start.id]) : undefined);
      this.draft = start ? this.#inferLine(start, end, ev) : { start: null, end, infer: null };
      return;
    }
    if (ev.type === 'down' && ev.button === 2) {
      this.draft = this.draft ? { ...this.draft, start: null } : null;
      return 'handled';
    }
    if (ev.type === 'dblclick') {
      this.draft = this.draft ? { ...this.draft, start: null } : null;
      return 'handled';
    }
    if (ev.type !== 'down' || ev.button !== 0) return ev.type === 'down' ? 'pan' : undefined;

    const snap = this.snapAt(ev, start?.kind === 'point' ? new Set([start.id]) : undefined);
    if (!start) {
      this.draft = { start: snap, end: snap, infer: null };
      return 'handled';
    }
    const d = this.#inferLine(start, snap, ev);
    const [s0, s1] = [
      worldToScreen(ev.view, ev.size, ...d.start!.pos),
      worldToScreen(ev.view, ev.size, ...d.end.pos),
    ];
    if (Math.hypot(s0[0] - s1[0], s0[1] - s1[1]) < 4) return 'handled';

    let endId: string | null = null;
    const created = this.apply((sk) => {
      const a = this.#realize(sk, d.start!);
      const b = a && this.#realize(sk, d.end);
      if (!a || !b || a === b) return false;
      const lineId = edit.addLine(sk, a, b);
      if (d.infer) edit.addConstraint(sk, { type: d.infer, refs: [lineId] }, this.ctx); // optional; ignore refusal
      if (!edit.resolve(sk, this.ctx)) return false;
      endId = b;
      return true;
    });
    if (!created || !endId) return 'handled';
    const endPt = store.project.sketch.points.find((p) => p.id === endId)!;
    // Closing onto an existing point ends the chain; otherwise continue from the new end.
    const closes = d.end.kind === 'point';
    const next: Snap = { kind: 'point', id: endId, pos: [endPt.x, endPt.y] };
    this.draft = closes ? { start: null, end: next, infer: null } : { start: next, end: next, infer: null };
    return 'handled';
  }

  #dimensionTool(ev: CanvasPointer): PointerResult {
    const layout = this.layoutFor(ev);
    // Dimension labels can be clicked to edit; relation glyphs are ignored here.
    const pick = (): Hit | null => {
      const h = hitTest(layout, ev.sx, ev.sy);
      if (h?.kind === 'constraint' && !layout.dims.some((d) => d.id === h.id))
        return hitTest(layout, ev.sx, ev.sy, undefined, true);
      return h;
    };
    if (ev.type === 'move') {
      const hit = pick();
      this.hover = hit && hit.kind !== 'constraint' ? hit.id : null;
      return;
    }
    if (ev.type === 'leave') {
      this.hover = null;
      return;
    }
    if (ev.type !== 'down') return;
    if (ev.button !== 0) return 'pan';
    const hit = pick();
    const sk = store.project.sketch;
    const kindOf = (id: string) => refKinds(sk, [id])[0];

    if (hit?.kind === 'constraint') {
      this.pending = [];
      this.selection = [hit.id];
      if (isDimension(sk.constraints.find((c) => c.id === hit.id)!)) this.editing = hit.id;
      return 'handled';
    }
    const first = this.pending[0];
    if (!hit) {
      // A single line, then a click in open space: its length.
      if (first && kindOf(first) === 'line') this.#createDimension('distance', [first], ev);
      else this.pending = [];
      return first ? 'handled' : 'pan';
    }
    if (!first) {
      this.pending = [hit.id];
      return 'handled';
    }
    const k1 = kindOf(first);
    const k2 = hit.kind;
    if (hit.id === first) {
      if (k1 === 'line') this.#createDimension('distance', [first], ev);
      return 'handled';
    }
    if (k1 === 'point' && k2 === 'point') this.#createDimension('distance', [first, hit.id], ev);
    else if (k1 === 'point' && k2 === 'line') this.#createDimension('distance', [first, hit.id], ev);
    else if (k1 === 'line' && k2 === 'point') this.#createDimension('distance', [hit.id, first], ev);
    else this.#createDimension('angle', [first, hit.id], ev);
    return 'handled';
  }

  #createDimension(type: ConstraintType, refs: string[], ev: CanvasPointer): void {
    this.pending = [];
    let id: string | undefined;
    this.apply((sk) => {
      const probe = { type, refs } as SketchConstraint;
      const anchor = dimensionAnchor(probe, sk);
      const r = edit.addConstraint(
        sk,
        { type, refs, ...(anchor ? { labelDx: ev.wx - anchor[0], labelDy: ev.wy - anchor[1] } : {}) },
        this.ctx,
      );
      if (r.ok) id = r.id;
      return r;
    });
    if (!id) return;
    this.selection = [id];
    const c = store.project.sketch.constraints.find((x) => x.id === id);
    if (c && !c.reference) this.editing = id;
  }

  #selectTool(ev: CanvasPointer): PointerResult {
    if (ev.type === 'leave') {
      this.hover = null;
      return;
    }
    if (ev.type === 'tap') {
      if (!ev.shift) this.selection = [];
      return;
    }
    if (ev.type === 'dblclick') {
      const hit = hitTest(this.layoutFor(ev), ev.sx, ev.sy);
      const c = hit?.kind === 'constraint' && store.project.sketch.constraints.find((x) => x.id === hit.id);
      if (c && isDimension(c)) {
        this.selection = [c.id];
        this.editing = c.id;
        return 'handled';
      }
      return;
    }
    if (ev.type === 'move' && !this.#drag) {
      this.hover = hitTest(this.layoutFor(ev), ev.sx, ev.sy)?.id ?? null;
      return;
    }
    if (ev.type === 'down') {
      if (ev.button !== 0) return 'pan';
      const hit = hitTest(this.layoutFor(ev), ev.sx, ev.sy);
      if (!hit) return 'pan';
      let selectOnClick: string | undefined;
      if (ev.shift) {
        this.selection = this.selection.includes(hit.id)
          ? this.selection.filter((x) => x !== hit.id)
          : [...this.selection, hit.id];
      } else if (!this.selection.includes(hit.id)) {
        this.selection = [hit.id];
      } else {
        selectOnClick = hit.id; // narrow a multi-selection on click (not on drag)
      }
      const start: Vec = [ev.wx, ev.wy];
      const sk = store.project.sketch;
      if (hit.kind === 'constraint') {
        const c = sk.constraints.find((x) => x.id === hit.id);
        if (c && isDimension(c)) this.#drag = { kind: 'label', id: c.id, start, moved: false, selectOnClick };
        else this.#drag = null;
        return 'handled';
      }
      // Drag the selected geometry (all endpoints of selected lines and selected points).
      const origin: Record<string, Vec> = {};
      for (const id of this.selection) {
        const l = sk.lines.find((x) => x.id === id);
        for (const pid of l ? [l.p1, l.p2] : [id]) {
          const p = sk.points.find((x) => x.id === pid);
          if (p) origin[pid] = [p.x, p.y];
        }
      }
      this.#drag = { kind: 'points', ids: Object.keys(origin), start, origin, moved: false, selectOnClick };
      return 'handled';
    }
    const drag = this.#drag;
    if (!drag) return;
    if (ev.type === 'move') {
      if (!drag.moved) {
        const s = worldToScreen(ev.view, ev.size, ...drag.start);
        if (Math.hypot(s[0] - ev.sx, s[1] - ev.sy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        store.beginGesture();
      }
      if (drag.kind === 'label') {
        const c = store.project.sketch.constraints.find((x) => x.id === drag.id);
        const off = c && labelOffsetFor(c, store.project.sketch, ev.view, ev.size, ev.sx, ev.sy);
        if (off)
          store.patch((p) =>
            Object.assign(
              p.sketch.constraints.find((x) => x.id === drag.id)!,
              off,
            ),
          );
        return;
      }
      let dx = ev.wx - drag.start[0];
      let dy = ev.wy - drag.start[1];
      if (this.gridSnap && !ev.alt && drag.ids.length === 1) {
        const step = gridSpacing(ev.view.scale).minor;
        const o = drag.origin[drag.ids[0]!]!;
        dx = Math.round((o[0] + dx) / step) * step - o[0];
        dy = Math.round((o[1] + dy) / step) * step - o[1];
      }
      const targets = drag.ids.map((id) => {
        const o = drag.origin[id]!;
        return { point: id, x: o[0] + dx, y: o[1] + dy };
      });
      store.patch((p) => {
        const sk = plain(p.sketch);
        if (edit.dragPoints(sk, targets, this.ctx)) p.sketch = sk;
      });
      return;
    }
    if (ev.type === 'up') {
      this.#drag = null;
      if (drag.moved) store.endGesture();
      else if (drag.selectOnClick) this.selection = [drag.selectOnClick];
    }
    return;
  }

  /** Screen position of a dimension label (for the inline editor). */
  labelScreenPos(id: string, view: CanvasPointer['view'], size: CanvasPointer['size']): Vec | undefined {
    const layout = layoutSketch({
      sketch: store.project.sketch,
      analysis: this.analysis,
      view,
      size,
      angleUnit: store.project.meta.angle_unit,
      angleScale: this.ctx.angleScale,
    });
    const d = layout.dims.find((x) => x.id === id);
    return d ? [d.lx, d.ly] : undefined;
  }

  /** Bounding box of the sketch in world units, for fitting the view. */
  extents(): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
    const pts = store.project.sketch.points;
    if (pts.length === 0) return undefined;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
    const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * 0.1;
    return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
  }

  /** Short description of the current tool's next step. */
  get hint(): string {
    switch (this.tool) {
      case 'point':
        return 'Click to place a point. Clicking on a line keeps the point on it.';
      case 'line':
        return this.draft?.start
          ? 'Click to end the line and keep drawing · Esc or right-click to stop · hold Alt to skip snapping'
          : 'Click to start a line. Lines snap to points, lines, the grid, and horizontal/vertical.';
      case 'dimension':
        return this.pending.length
          ? 'Click a second point or line, or click open space to dimension the line’s length'
          : 'Click a line for its length, two points for a distance, or two lines for an angle';
      case 'pan':
        return 'Drag to pan · scroll to zoom';
      default:
        return '';
    }
  }
}

export const sketchUi = new SketchUi();

/** Human-readable name of a constraint, e.g. "Distance P1–P2". */
export function describeConstraint(c: SketchConstraint): string {
  return `${CONSTRAINT_DEFS[c.type].label} ${c.refs.join('–')}`;
}

/** Keyboard shortcuts for applying relations to the selection. */
export const RELATION_KEYS: Partial<Record<ConstraintType, string>> = {
  horizontal: 'H',
  vertical: 'V',
  coincident: 'C',
  equal: 'E',
  midpoint: 'M',
  point_on_line: 'O',
};

export type SketchState = 'empty' | 'under' | 'full' | 'over';

/** Overall definition state of the sketch. */
export function sketchState(sketch: Sketch, a: SketchAnalysis): SketchState {
  if (sketch.points.length === 0) return 'empty';
  if (a.redundant.size || a.unsatisfied.size) return 'over';
  return a.dof > 0 ? 'under' : 'full';
}
