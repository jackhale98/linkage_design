export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

let nextId = 1;

class Toasts {
  items = $state<Toast[]>([]);

  show(message: string, kind: ToastKind = 'info', action?: ToastAction, timeoutMs = 5000): void {
    const id = nextId++;
    this.items = [...this.items.slice(-3), { id, kind, message, action }];
    if (timeoutMs > 0) setTimeout(() => this.dismiss(id), timeoutMs);
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
