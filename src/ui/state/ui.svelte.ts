// UI preferences that persist per browser: theme, workspace, dock layout.

import * as storage from '../lib/storage';

export type Workspace = 'sketch' | 'mechanism' | 'motion' | 'forces' | 'cam';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type DockTab = 'plots' | 'tables' | 'results' | 'messages';

export const WORKSPACES: { id: Workspace; label: string; key: string }[] = [
  { id: 'sketch', label: 'Sketch', key: '1' },
  { id: 'mechanism', label: 'Mechanism', key: '2' },
  { id: 'motion', label: 'Motion', key: '3' },
  { id: 'forces', label: 'Forces', key: '4' },
  { id: 'cam', label: 'Cam', key: '5' },
];

function loadJson<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  const raw = storage.load(key);
  if (raw === null) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

const isWorkspace = (v: unknown): v is Workspace => WORKSPACES.some((w) => w.id === v);
const isTheme = (v: unknown): v is ThemeChoice => v === 'system' || v === 'light' || v === 'dark';
const isDockTab = (v: unknown): v is DockTab =>
  ['plots', 'tables', 'results', 'messages'].includes(v as string);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

class UiState {
  workspace = $state<Workspace>(loadJson('workspace', 'sketch', isWorkspace));
  theme = $state<ThemeChoice>(loadJson('theme', 'system', isTheme));
  dockTab = $state<DockTab>(loadJson('dockTab', 'messages', isDockTab));
  dockOpen = $state<boolean>(loadJson('dockOpen', false, isBool));
  dockHeight = $state<number>(loadJson('dockHeight', 220, isNumber));
  inspectorOpen = $state(false);

  persist(): void {
    storage.save('workspace', JSON.stringify(this.workspace));
    storage.save('theme', JSON.stringify(this.theme));
    storage.save('dockTab', JSON.stringify(this.dockTab));
    storage.save('dockOpen', JSON.stringify(this.dockOpen));
    storage.save('dockHeight', JSON.stringify(Math.round(this.dockHeight)));
  }

  cycleTheme(): void {
    this.theme = this.theme === 'system' ? 'light' : this.theme === 'light' ? 'dark' : 'system';
  }

  openDock(tab: DockTab): void {
    this.dockTab = tab;
    this.dockOpen = true;
  }
}

export const ui = new UiState();
