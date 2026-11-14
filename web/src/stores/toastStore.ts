import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Optional button on the toast (e.g. "View"). */
  action?: { label: string; run: () => void };
  /** How long it stays, ms (errors stay longer). 0 = until dismissed. */
  ttl: number;
}

export const MAX_TOASTS = 4;

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'kind' | 'ttl'> & { kind?: ToastKind; ttl?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const kind = t.kind ?? 'info';
    const toast: Toast = {
      ...t,
      id: nextId++,
      kind,
      ttl: t.ttl ?? (kind === 'error' ? 8000 : 4500),
    };
    // Newest last; when too many pile up the oldest goes first.
    set({ toasts: [...get().toasts, toast].slice(-MAX_TOASTS) });
    return toast.id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clear: () => set({ toasts: [] }),
}));

/** Show a notification from anywhere (stores, handlers), not just React components. */
export const toast = (t: Parameters<ToastState['push']>[0]) => useToasts.getState().push(t);
