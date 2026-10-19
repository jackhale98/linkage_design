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

  #record(coalesceKey?: string): void {
    const now = Date.now();
    const coalesce =
      coalesceKey !== undefined && coalesceKey === this.#lastKey && now - this.#lastTime < COALESCE_MS;
    if (!coalesce) {
      this.#past.push(this.#snapshot());
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
   * Apply an edit. Edits sharing a `coalesceKey` within a second (e.g. typing
   * in one field) become a single undo step.
   */
  update(mutate: (p: Project) => void, coalesceKey?: string): void {
    this.#record(coalesceKey);
    mutate(this.project);
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
