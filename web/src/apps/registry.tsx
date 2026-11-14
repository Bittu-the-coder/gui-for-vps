import {
  Activity,
  Container,
  FileCode2,
  FolderOpen,
  GraduationCap,
  FolderGit2,
  Hammer,
  Network,
  History,
  ListChecks,
  ScrollText,
  Server,
  Settings2,
  SquareTerminal,
  Zap,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { AppIconSpec } from '../components/icons/AppIcon';
import { ServersApp } from './servers/ServersApp';
import { TerminalApp } from './terminal/TerminalApp';
import { RecipesApp } from './recipes/RecipesApp';
import { SnapshotsApp } from './snapshots/SnapshotsApp';
import { DevHubApp } from './devhub/DevHubApp';
import { DockerApp } from './docker/DockerApp';
import { MonitorApp } from './monitor/MonitorApp';
import { ServicesApp } from './services/ServicesApp';
import { EditorApp } from './editor/EditorApp';
import { FilesApp } from './files/FilesApp';
import { ActionsApp } from './actions/ActionsApp';
import { JobsApp } from './jobs/JobsApp';
import { LessonsApp } from './lessons/LessonsApp';
import { NetworkApp } from './network/NetworkApp';
import { ProjectsApp } from './projects/ProjectsApp';

export interface AppDef extends AppIconSpec {
  id: string;
  title: string;
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
    icon: Server,
    tint: ['#7d8bff', '#3b46d6'],
    component: ServersApp,
    defaultSize: { w: 600, h: 440 },
    singleton: true,
  },
  {
    id: 'terminal',
    title: 'Terminal',
    icon: SquareTerminal,
    tint: ['#4a4a4f', '#141416'],
    component: TerminalApp,
    defaultSize: { w: 760, h: 460 },
    serverBound: true,
  },
  {
    id: 'files',
    title: 'Files',
    icon: FolderOpen,
    tint: ['#5ac8fa', '#0a6fe0'],
    component: FilesApp,
    defaultSize: { w: 760, h: 500 },
    serverBound: true,
  },
  {
    id: 'devhub',
    title: 'Dev Hub',
    icon: Hammer,
    tint: ['#ffb340', '#f26a00'],
    component: DevHubApp,
    defaultSize: { w: 720, h: 560 },
    serverBound: true,
  },
  {
    id: 'monitor',
    title: 'Monitor',
    icon: Activity,
    tint: ['#4cd97b', '#12994a'],
    component: MonitorApp,
    defaultSize: { w: 820, h: 600 },
    serverBound: true,
  },
  {
    id: 'services',
    title: 'Services',
    icon: Settings2,
    tint: ['#a1a1a8', '#5a5a60'],
    component: ServicesApp,
    defaultSize: { w: 760, h: 520 },
    serverBound: true,
  },
  {
    id: 'docker',
    title: 'Docker',
    icon: Container,
    tint: ['#3ec6e8', '#0b7fc4'],
    component: DockerApp,
    defaultSize: { w: 760, h: 520 },
    serverBound: true,
  },
  {
    id: 'snapshots',
    title: 'Snapshots',
    icon: History,
    tint: ['#c77dff', '#7d3fb0'],
    component: SnapshotsApp,
    defaultSize: { w: 900, h: 560 },
    serverBound: true,
  },
  {
    id: 'recipes',
    title: 'Recipes',
    icon: ScrollText,
    tint: ['#ff7a98', '#d02f63'],
    component: RecipesApp,
    defaultSize: { w: 820, h: 540 },
    singleton: true,
  },
  {
    id: 'jobs',
    title: 'Jobs',
    icon: ListChecks,
    tint: ['#2dd4bf', '#0f8f84'],
    component: JobsApp,
    defaultSize: { w: 880, h: 580 },
    singleton: true,
  },
  {
    id: 'projects',
    title: 'Projects',
    icon: FolderGit2,
    tint: ['#fb923c', '#dc2626'],
    component: ProjectsApp,
    defaultSize: { w: 820, h: 560 },
    serverBound: true,
  },
  {
    id: 'network',
    title: 'Network',
    icon: Network,
    tint: ['#38bdf8', '#2563eb'],
    component: NetworkApp,
    defaultSize: { w: 780, h: 520 },
    serverBound: true,
  },
  {
    id: 'lessons',
    title: 'Lessons',
    icon: GraduationCap,
    tint: ['#facc15', '#d97706'],
    component: LessonsApp,
    defaultSize: { w: 760, h: 560 },
    singleton: true,
  },
  {
    id: 'editor',
    title: 'Editor',
    icon: FileCode2,
    tint: ['#ffd60a', '#f59e0b'],
    component: EditorApp,
    defaultSize: { w: 820, h: 560 },
    serverBound: true,
    hidden: true,
  },
  {
    id: 'actions',
    title: 'Actions',
    icon: Zap,
    tint: ['#8b8bff', '#4b3fd1'],
    component: ActionsApp,
    defaultSize: { w: 560, h: 480 },
    serverBound: true,
  },
];

/** Apps a user can launch directly. */
export const LAUNCHABLE = APPS.filter((a) => !a.hidden);

export const appById = (id: string) => APPS.find((a) => a.id === id);
