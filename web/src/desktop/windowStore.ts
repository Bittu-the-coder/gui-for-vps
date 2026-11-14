import { create } from 'zustand';
import { z } from 'zod';
import { readJson, writeJson } from '../lib/storage';

export const WindowStateSchema = z.object({
  id: z.string(),
  appId: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().min(200),
  h: z.number().min(120),
  z: z.number(),
  minimized: z.boolean(),
  maximized: z.boolean(),
  /** Which server this window is tied to. Unused until M2. */
  serverId: z.string().optional(),
  /** What the window was opened with (the Editor's file path). */
  arg: z.string().optional(),
});
export type WindowState = z.infer<typeof WindowStateSchema>;

const PersistedSchema = z.object({
  windows: z.array(WindowStateSchema),
  nextZ: z.number(),
  theme: z.enum(['light', 'dark']),
});

const STORAGE_KEY = 'gfv.desktop.v1';

export interface OpenOptions {
  appId: string;
  title: string;
  w: number;
  h: number;
  /** Server this window is tied to (shown as a coloured border + badge). */
  serverId?: string;
  /** App-specific argument, e.g. the file path for the Editor. */
  arg?: string;
}

interface DesktopState {
  windows: Record<string, WindowState>;
  focusedId: string | null;
  nextZ: number;
  theme: 'light' | 'dark';
  /** Windows whose close animation is running (transient, never persisted). */
  closing: Record<string, true>;
  open: (opts: OpenOptions) => string;
  /** Start closing: the Window plays its close animation, then calls `close`. */
  requestClose: (id: string) => void;
  /** Remove the window right now (no animation). */
  close: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number, x: number, y: number) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

/** Remembers the un-maximized rectangle so restore puts the window back. */
const restoreRects = new Map<string, Pick<WindowState, 'x' | 'y' | 'w' | 'h'>>();

let idCounter = 0;

/** Windows opened since the page loaded: only these play the open animation (not every window on a reload). */
const freshIds = new Set<string>();
export function consumeFresh(id: string): boolean {
  return freshIds.delete(id);
}

function topVisibleId(windows: Record<string, WindowState>): string | null {
  const visible = Object.values(windows).filter((w) => !w.minimized);
  visible.sort((a, b) => b.z - a.z);
  return visible[0]?.id ?? null;
}

function loadInitial(): Pick<DesktopState, 'windows' | 'nextZ' | 'theme'> {
  const parsed = PersistedSchema.safeParse(readJson(STORAGE_KEY));
  // First visit: follow the system's light/dark preference.
  const system = (): 'light' | 'dark' =>
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  if (!parsed.success) return { windows: {}, nextZ: 1, theme: system() };
  const windows = Object.fromEntries(parsed.data.windows.map((w) => [w.id, w]));
  return { windows, nextZ: parsed.data.nextZ, theme: parsed.data.theme };
}

/** An app with unsaved work registers a guard; closing its window then asks first. */
const closeGuards = new Map<string, () => boolean>();
export function registerCloseGuard(windowId: string, isDirty: () => boolean): () => void {
  closeGuards.set(windowId, isDirty);
  return () => {
    closeGuards.delete(windowId);
  };
}

/** What the close button calls: asks before discarding unsaved changes, then closes with an animation. */
export function tryClose(windowId: string): void {
  if (closeGuards.get(windowId)?.() && !window.confirm('Discard your unsaved changes?')) return;
  useDesktop.getState().requestClose(windowId);
}

export const useDesktop = create<DesktopState>((set, get) => ({
  ...loadInitial(),
  focusedId: null,
  closing: {},

  open: ({ appId, title, w, h, serverId, arg }) => {
    const { nextZ, windows } = get();
    const id = `win-${Date.now().toString(36)}-${idCounter++}`;
    // Cascade new windows so they don't stack exactly on top of each other.
    const offset = (Object.keys(windows).length % 8) * 28;
    const win: WindowState = {
      id,
      appId,
      title,
      x: 80 + offset,
      y: 60 + offset,
      w,
      h,
      z: nextZ,
      minimized: false,
      maximized: false,
      ...(serverId ? { serverId } : {}),
      ...(arg ? { arg } : {}),
    };
    freshIds.add(id);
    set({ windows: { ...windows, [id]: win }, nextZ: nextZ + 1, focusedId: id });
    return id;
  },

  requestClose: (id) => {
    if (!get().windows[id] || get().closing[id]) return;
    set({ closing: { ...get().closing, [id]: true } });
  },

  close: (id) => {
    const { [id]: _removed, ...rest } = get().windows;
    void _removed;
    restoreRects.delete(id);
    freshIds.delete(id);
    const { [id]: _c, ...closing } = get().closing;
    void _c;
    set({ windows: rest, closing, focusedId: topVisibleId(rest) });
  },

  setTitle: (id, title) => {
    const win = get().windows[id];
    if (!win || win.title === title) return;
    set({ windows: { ...get().windows, [id]: { ...win, title } } });
  },

  focus: (id) => {
    const { windows, nextZ, focusedId } = get();
    const win = windows[id];
    if (!win) return;
    if (focusedId === id && !win.minimized) return;
    set({
      windows: { ...windows, [id]: { ...win, z: nextZ, minimized: false } },
      nextZ: nextZ + 1,
      focusedId: id,
    });
  },

  minimize: (id) => {
    const { windows } = get();
    const win = windows[id];
    if (!win) return;
    const next = { ...windows, [id]: { ...win, minimized: true } };
    set({ windows: next, focusedId: topVisibleId(next) });
  },

  toggleMaximize: (id) => {
    const { windows } = get();
    const win = windows[id];
    if (!win) return;
    if (win.maximized) {
      const r = restoreRects.get(id);
      restoreRects.delete(id);
      set({ windows: { ...windows, [id]: { ...win, ...r, maximized: false } } });
    } else {
      restoreRects.set(id, { x: win.x, y: win.y, w: win.w, h: win.h });
      set({ windows: { ...windows, [id]: { ...win, maximized: true } } });
    }
  },

  move: (id, x, y) => {
    const win = get().windows[id];
    if (!win || win.maximized) return;
    set({ windows: { ...get().windows, [id]: { ...win, x, y } } });
  },

  resize: (id, w, h, x, y) => {
    const win = get().windows[id];
    if (!win || win.maximized) return;
    set({ windows: { ...get().windows, [id]: { ...win, w, h, x, y } } });
  },

  toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
  setTheme: (theme) => set({ theme }),
}));

// Persist layout (debounced) whenever windows or theme change. Dragging fires many updates,
// so we wait 300ms of quiet — but a pending write must not be lost if the page goes away.
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function flush() {
  clearTimeout(timer);
  if (!dirty) return;
  dirty = false;
  const s = useDesktop.getState();
  writeJson(STORAGE_KEY, { windows: Object.values(s.windows), nextZ: s.nextZ, theme: s.theme });
}

useDesktop.subscribe((s, prev) => {
  if (s.windows === prev.windows && s.theme === prev.theme) return;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
});

// Reload / tab close / navigating away: write immediately (pagehide also covers mobile + bfcache).
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
