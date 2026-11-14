import type { MenuItem } from '../components/menu/menuItems';
import type { AppDef } from '../apps/registry';
import type { AppMenus } from './appMenus';
import { WALLPAPERS } from './wallpapers';
import type { WindowState } from './windowStore';

/** Everything the menus need to know, plus the things they can do. Pure data in, pure data out. */
export interface MenuCtx {
  /** The focused window's app, if any. */
  activeApp?: AppDef;
  activeWindow?: WindowState;
  windows: WindowState[];
  /** What the focused app adds (read when the menu opens). */
  app: AppMenus;
  /** Text currently selected on the page (for the generic Copy). */
  selectedText: string;
  theme: 'light' | 'dark';
  wallpaper: string;
  reduceTransparency: boolean;
  learnOpen: boolean;
  /** Apps that can be opened (the Dock's apps). */
  launchable: AppDef[];
  act: {
    openApp: (app: AppDef) => void;
    copyText: (text: string) => void;
    missionControl: () => void;
    closeWindow: (id: string) => void;
    minimize: (id: string) => void;
    zoom: (id: string) => void;
    focus: (id: string) => void;
    setTheme: (t: 'light' | 'dark') => void;
    setWallpaper: (id: string) => void;
    setReduceTransparency: (on: boolean) => void;
    toggleLearn: () => void;
    tour: () => void;
    changePassword: () => void;
    lock: () => void;
  };
}

export type MenuKey = 'gfv' | 'file' | 'edit' | 'view' | 'window' | 'help';

/** Menus shown for the focused app. (Edit and per-app items arrive with the app contributions in M10b.) */
export function buildMenus(c: MenuCtx): Record<MenuKey, MenuItem[]> {
  const { act } = c;
  const win = c.activeWindow;
  const terminal = c.launchable.find((a) => a.id === 'terminal');

  const gfv: MenuItem[] = [
    { type: 'label', label: 'Appearance' },
    { label: 'Light', checked: c.theme === 'light', onSelect: () => act.setTheme('light') },
    { label: 'Dark', checked: c.theme === 'dark', onSelect: () => act.setTheme('dark') },
    { type: 'separator' },
    { type: 'label', label: 'Wallpaper' },
    ...WALLPAPERS.map<MenuItem>((w) => ({
      label: w.name,
      checked: c.wallpaper === w.id,
      onSelect: () => act.setWallpaper(w.id),
    })),
    { type: 'separator' },
    {
      label: 'Reduce Transparency',
      checked: c.reduceTransparency,
      onSelect: () => act.setReduceTransparency(!c.reduceTransparency),
    },
    { type: 'separator' },
    { label: 'Change Master Password…', onSelect: act.changePassword },
    { label: 'Lock Vault', onSelect: act.lock },
  ];

  // "New Window" opens another window of the focused app (if it allows several), else a Terminal.
  const newTarget = c.activeApp && !c.activeApp.singleton ? c.activeApp : terminal;
  const SEP: MenuItem = { type: 'separator' };
  const withApp = (own: MenuItem[] | undefined, shell: MenuItem[]): MenuItem[] =>
    own?.length ? [...own, SEP, ...shell] : shell;

  const fileShell: MenuItem[] = [
    {
      label: newTarget && newTarget === c.activeApp ? 'New Window' : 'New Terminal Window',
      disabled: !newTarget,
      onSelect: () => newTarget && act.openApp(newTarget),
    },
    { type: 'separator' },
    {
      label: 'Close Window',
      disabled: !win,
      onSelect: () => win && act.closeWindow(win.id),
    },
  ];
  const file = withApp(c.app.file, fileShell);

  // Apps with their own Edit items (Terminal, Editor) replace this generic one.
  const edit: MenuItem[] = c.app.edit?.length
    ? c.app.edit
    : [
        {
          label: 'Copy',
          disabled: !c.selectedText,
          onSelect: () => act.copyText(c.selectedText),
        },
      ];

  const viewShell: MenuItem[] = [
    {
      label: 'Learn Mode Panel',
      checked: c.learnOpen,
      onSelect: act.toggleLearn,
    },
    { type: 'separator' },
    {
      label: win?.maximized ? 'Exit Zoom' : 'Zoom Window',
      disabled: !win,
      onSelect: () => win && act.zoom(win.id),
    },
    { label: 'Mission Control', onSelect: act.missionControl },
  ];
  const view = withApp(c.app.view, viewShell);

  const sorted = [...c.windows].sort((a, b) => a.title.localeCompare(b.title));
  const windowMenu: MenuItem[] = [
    {
      label: 'Minimize',
      disabled: !win,
      onSelect: () => win && act.minimize(win.id),
    },
    {
      label: win?.maximized ? 'Exit Zoom' : 'Zoom',
      disabled: !win,
      onSelect: () => win && act.zoom(win.id),
    },
    ...(sorted.length
      ? ([
          { type: 'separator' },
          ...sorted.map<MenuItem>((w) => ({
            label: w.minimized ? `${w.title} (minimized)` : w.title,
            checked: w.id === win?.id,
            onSelect: () => act.focus(w.id),
          })),
        ] as MenuItem[])
      : []),
  ];

  const help: MenuItem[] = [{ label: 'Take the Tour', onSelect: act.tour }];

  return { gfv, file, edit, view, window: windowMenu, help };
}
