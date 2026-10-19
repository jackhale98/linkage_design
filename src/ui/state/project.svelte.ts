// The open project, with undo/redo history and autosave.
//
// History stores serialised snapshots. Projects are small, so this is simple
// and can't drift out of sync the way command-based undo can.

import type { Diagnostic } from '../../core/csv/diagnostics';
import { newProject, parseProject, serializeProject, type Project } from '../../core/model/project';
import * as storage from '../lib/storage';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1000;
const AUTOSAVE_KEY = 'autosave';

export interface ImportReport {
  fileName: string;
  ok: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

class ProjectStore {
  project = $state<Project>(newProject());
  canUndo = $state(false);
  canRedo = $state(false);
  /** Result of the most recent file import, shown in the Messages tab. */
  lastImport = $state<ImportReport | null>(null);

  #past: string[] = [];
  #future: string[] = [];
  #lastKey: string | undefined;
  #lastTime = 0;

  #snapshot(): string {
    return JSON.stringify($state.snapshot(this.project));
  }

  #restore(json: string): void {
    this.project = JSON.parse(json) as Project;
  }

  #record(coalesceKey?: string, before = this.#snapshot()): void {
    const now = Date.now();
    const coalesce =
      coalesceKey !== undefined && coalesceKey === this.#lastKey && now - this.#lastTime < COALESCE_MS;
    if (!coalesce) {
      this.#past.push(before);
      if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
    }
    this.#future = [];
    this.#lastKey = coalesceKey;
    this.#lastTime = now;
    this.#sync();
  }

  #sync(): void {
    this.canUndo = this.#past.length > 0;
    this.canRedo = this.#future.length > 0;
  }

  /**
   * Apply an edit as one undo step. Edits sharing a `coalesceKey` within a
   * second (e.g. typing in one field) become a single undo step.
   */
  update(mutate: (p: Project) => void, coalesceKey?: string): void {
    const before = this.#snapshot();
    mutate(this.project);
    this.#record(coalesceKey, before);
    this.project.meta.modified = new Date().toISOString();
  }

  /**
   * Apply an edit that may be refused. `mutate` returns true if it changed
   * the project, or false if it refused (leaving the project unchanged), in
   * which case no undo step is recorded.
   */
  tryUpdate(mutate: (p: Project) => boolean): boolean {
    const before = this.#snapshot();
    if (!mutate(this.project)) return false;
    this.#record(undefined, before);
    this.project.meta.modified = new Date().toISOString();
    return true;
  }

  #gesture: string | null = null;

  /** Start a continuous edit (e.g. a drag) that becomes one undo step. */
  beginGesture(): void {
    this.#gesture ??= this.#snapshot();
  }

  /** Change the project during a gesture without recording history. */
  patch(mutate: (p: Project) => void): void {
    mutate(this.project);
  }

  /** Finish a gesture, recording one undo step if anything changed. */
  endGesture(): void {
    const before = this.#gesture;
    this.#gesture = null;
    if (before === null || before === this.#snapshot()) return;
    this.#record(undefined, before);
    this.project.meta.modified = new Date().toISOString();
  }

  /** Replace the whole project (new or opened file). Undoable. */
  replace(p: Project): void {
    this.#record();
    this.#lastKey = undefined;
    this.project = p;
  }

  undo(): void {
    const prev = this.#past.pop();
    if (prev === undefined) return;
    this.#future.push(this.#snapshot());
    this.#restore(prev);
    this.#lastKey = undefined;
    this.#sync();
  }

  redo(): void {
    const next = this.#future.pop();
    if (next === undefined) return;
    this.#past.push(this.#snapshot());
    this.#restore(next);
    this.#lastKey = undefined;
    this.#sync();
  }

  /** Parse file text and open it if valid. The current project is untouched on error. */
  importText(fileName: string, text: string): ImportReport {
    const r = parseProject(text);
    const report: ImportReport = r.ok
      ? { fileName, ok: true, errors: [], warnings: r.warnings }
      : { fileName, ok: false, errors: r.errors, warnings: r.warnings };
    if (r.ok) this.replace(r.project);
    this.lastImport = report;
    return report;
  }

  exportText(): string {
    return serializeProject($state.snapshot(this.project) as Project);
  }

  /** Save to browser storage, in the same CSV format as exported files. */
  autosave(): void {
    storage.save(AUTOSAVE_KEY, this.exportText());
  }

  /** Restore the autosaved session, if there is a valid one. */
  restoreAutosave(): boolean {
    const text = storage.load(AUTOSAVE_KEY);
    if (!text) return false;
    const r = parseProject(text);
    if (!r.ok) return false;
    this.project = r.project;
    return true;
  }
}

export const store = new ProjectStore();
