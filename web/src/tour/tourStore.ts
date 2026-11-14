import { create } from 'zustand';
import { readJson, writeJson } from '../lib/storage';

const KEY = 'gfv.tour.v1';

interface TourState {
  open: boolean;
  step: number;
  start: () => void;
  next: () => void;
  back: () => void;
  /** Close it for good (Skip or Done): it will not pop up again by itself. */
  finish: () => void;
}

export const TOUR_STEPS = [
  {
    target: 'app-servers',
    title: 'Add your first server',
    body: 'Click Servers in the Dock, then add the host, user and an SSH key or password. They are encrypted with your master password and never leave this computer.',
  },
  {
    target: 'server-switcher',
    title: 'Pick the active server',
    body: 'Every window is tied to one server, shown by its colour. New windows open on the one you pick here, in the menu bar.',
  },
  {
    target: 'app-terminal',
    title: 'Open apps on it',
    body: 'Click an app in the Dock: Terminal, Files, Monitor, Services, Docker, Dev Hub… Dangerous commands ask for confirmation first: that is the Safety Net.',
  },
  {
    target: 'learn',
    title: 'Learn Mode',
    body: 'The Learn button in the menu bar shows a panel: every action shows the real command and a plain-English explanation. The journal on the right keeps every command GFV ran for you.',
  },
  {
    target: 'record',
    title: 'Record a recipe',
    body: 'Press Record in the menu bar, do things in GFV, press Stop, and export what you did as a bash script you can run on another server.',
  },
] as const;

export const useTour = create<TourState>((set, get) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  next: () =>
    get().step >= TOUR_STEPS.length - 1 ? get().finish() : set({ step: get().step + 1 }),
  back: () => set({ step: Math.max(0, get().step - 1) }),
  finish: () => {
    writeJson(KEY, true);
    set({ open: false, step: 0 });
  },
}));

/** Show the tour by itself the first time only. */
export const tourSeen = (): boolean => readJson(KEY) === true;
