import type { ComponentType } from 'react';
import { ServersApp } from './servers/ServersApp';
import { ClockApp, HelloApp, NotesApp } from './dummy';

export interface AppDef {
  id: string;
  title: string;
  icon: string; // emoji for now; real icons come with the real apps
  component: ComponentType<{ windowId: string }>;
  defaultSize: { w: number; h: number };
  /** New windows get tied to the active server (coloured border + badge). */
  serverBound?: boolean;
  /** Opening again focuses the existing window instead of making a second one. */
  singleton?: boolean;
}

/** Adding a real app later = adding one entry here. The shell never changes. */
export const APPS: AppDef[] = [
  {
    id: 'servers',
    title: 'Servers',
    icon: '🖥️',
    component: ServersApp,
    defaultSize: { w: 600, h: 440 },
    singleton: true,
  },
  { id: 'notes', title: 'Notes', icon: '📝', component: NotesApp, defaultSize: { w: 420, h: 320 } },
  { id: 'clock', title: 'Clock', icon: '🕒', component: ClockApp, defaultSize: { w: 280, h: 160 } },
  // Dummy app that is server-bound, to demo the window <-> server tie until real apps arrive.
  {
    id: 'hello',
    title: 'Hello',
    icon: '👋',
    component: HelloApp,
    defaultSize: { w: 340, h: 200 },
    serverBound: true,
  },
];

export const appById = (id: string) => APPS.find((a) => a.id === id);
