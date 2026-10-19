export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** 1-based line in the source file, when known. */
  line?: number;
  section?: string;
  column?: string;
  /** Machine-readable kind, for callers that need to react to specific problems. */
  code?: 'csv-syntax';
}

/** Collects errors and warnings while reading a file. */
export class Diagnostics {
  readonly items: Diagnostic[] = [];

  error(message: string, where: Omit<Diagnostic, 'severity' | 'message'> = {}): void {
    this.items.push({ severity: 'error', message, ...where });
  }

  warn(message: string, where: Omit<Diagnostic, 'severity' | 'message'> = {}): void {
    this.items.push({ severity: 'warning', message, ...where });
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'error');
  }

  get warnings(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'warning');
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }
}

/** One-line human-readable form, e.g. "Line 12 [points] x: not a number". */
export function formatDiagnostic(d: Diagnostic): string {
  const where = [
    d.line !== undefined ? `Line ${d.line}` : '',
    d.section ? `[${d.section}]` : '',
    d.column ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return where ? `${where}: ${d.message}` : d.message;
}
