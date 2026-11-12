import type { ComponentType } from 'react';
import { ServersApp } from './servers/ServersApp';
import { TerminalApp } from './terminal/TerminalApp';
import { DockerApp } from './docker/DockerApp';
import { MonitorApp } from './monitor/MonitorApp';
import { ServicesApp } from './services/ServicesApp';
import { EditorApp } from './editor/EditorApp';
import { FilesApp } from './files/FilesApp';
import { ActionsApp } from './actions/ActionsApp';

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
  /** Opened by other apps (e.g. the Editor from the File Manager), not from the desktop or Start menu. */
  hidden?: boolean;
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
  {
    id: 'terminal',
    title: 'Terminal',
    icon: '⌨️',
    component: TerminalApp,
    defaultSize: { w: 760, h: 460 },
    serverBound: true,
  },
  {
    id: 'files',
    title: 'Files',
    icon: '📁',
    component: FilesApp,
    defaultSize: { w: 760, h: 500 },
    serverBound: true,
  },
  {
    id: 'monitor',
    title: 'Monitor',
    icon: '📊',
    component: MonitorApp,
    defaultSize: { w: 820, h: 600 },
    serverBound: true,
  },
  {
    id: 'services',
    title: 'Services',
    icon: '⚙️',
    component: ServicesApp,
    defaultSize: { w: 760, h: 520 },
    serverBound: true,
  },
  {
    id: 'docker',
    title: 'Docker',
    icon: '🐳',
    component: DockerApp,
    defaultSize: { w: 760, h: 520 },
    serverBound: true,
  },
  {
    id: 'editor',
    title: 'Editor',
    icon: '📝',
    component: EditorApp,
    defaultSize: { w: 820, h: 560 },
    serverBound: true,
    hidden: true,
  },
  {
    id: 'actions',
    title: 'Actions',
    icon: '⚡',
    component: ActionsApp,
    defaultSize: { w: 560, h: 480 },
    serverBound: true,
  },
];

/** Apps a user can launch directly. */
export const LAUNCHABLE = APPS.filter((a) => !a.hidden);

export const appById = (id: string) => APPS.find((a) => a.id === id);
