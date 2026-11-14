import { describe, expect, it, vi } from 'vitest';
import { APPS } from '../apps/registry';
import type { MenuItem } from '../components/menu/menuItems';
import { buildMenus, type MenuCtx } from './menuModel';
import type { WindowState } from './windowStore';

const win = (over: Partial<WindowState>): WindowState => ({
  id: 'w1',
  appId: 'files',
  title: 'Files',
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  z: 1,
  minimized: false,
  maximized: false,
  ...over,
});

function ctx(over: Partial<MenuCtx> = {}) {
  const act = {
    openApp: vi.fn(),
    copyText: vi.fn(),
    missionControl: vi.fn(),
    closeWindow: vi.fn(),
    minimize: vi.fn(),
    zoom: vi.fn(),
    focus: vi.fn(),
    setTheme: vi.fn(),
    setWallpaper: vi.fn(),
    setReduceTransparency: vi.fn(),
    toggleLearn: vi.fn(),
    tour: vi.fn(),
    changePassword: vi.fn(),
    lock: vi.fn(),
  };
  const launchable = APPS.filter((a) => !a.hidden);
  const c: MenuCtx = {
    windows: [],
    app: {},
    selectedText: '',
    theme: 'light',
    wallpaper: 'aurora',
    reduceTransparency: false,
    learnOpen: true,
    launchable,
    act,
    ...over,
  };
  return { c, act };
}
const labelled = (items: MenuItem[]) =>
  items.filter((i): i is Extract<MenuItem, { onSelect: () => void }> => 'onSelect' in i);
const find = (items: MenuItem[], label: string) => labelled(items).find((i) => i.label === label)!;

describe('buildMenus', () => {
  it('GFV menu: marks the current theme and wallpaper, and acts on selection', () => {
    const { c, act } = ctx({ theme: 'dark', wallpaper: 'dusk' });
    const m = buildMenus(c).gfv;
    expect(find(m, 'Dark').checked).toBe(true);
    expect(find(m, 'Light').checked).toBe(false);
    expect(find(m, 'Dusk').checked).toBe(true);
    find(m, 'Meadow').onSelect();
    expect(act.setWallpaper).toHaveBeenCalledWith('meadow');
    find(m, 'Reduce Transparency').onSelect();
    expect(act.setReduceTransparency).toHaveBeenCalledWith(true);
  });

  it('with no window: Close/Minimize/Zoom are disabled and New opens a Terminal', () => {
    const { c, act } = ctx();
    const menus = buildMenus(c);
    expect(find(menus.file, 'Close Window').disabled).toBe(true);
    expect(find(menus.window, 'Minimize').disabled).toBe(true);
    find(menus.file, 'New Terminal Window').onSelect();
    expect(act.openApp).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal' }));
  });

  it('a focused multi-window app gets "New Window" for itself', () => {
    const files = APPS.find((a) => a.id === 'files')!;
    const w = win({});
    const { c, act } = ctx({ activeApp: files, activeWindow: w, windows: [w] });
    find(buildMenus(c).file, 'New Window').onSelect();
    expect(act.openApp).toHaveBeenCalledWith(files);
    find(buildMenus(c).file, 'Close Window').onSelect();
    expect(act.closeWindow).toHaveBeenCalledWith('w1');
  });

  it('a singleton app falls back to a Terminal for "New"', () => {
    const servers = APPS.find((a) => a.id === 'servers')!;
    const w = win({ appId: 'servers', title: 'Servers' });
    const { c } = ctx({ activeApp: servers, activeWindow: w, windows: [w] });
    expect(labelled(buildMenus(c).file)[0]!.label).toBe('New Terminal Window');
  });

  it('Window menu lists every window, ticks the focused one and flags minimized ones', () => {
    const a = win({ id: 'a', title: 'Files' });
    const b = win({ id: 'b', title: 'Monitor', minimized: true });
    const { c, act } = ctx({ activeWindow: a, windows: [a, b] });
    const m = buildMenus(c).window;
    expect(find(m, 'Files').checked).toBe(true);
    expect(find(m, 'Monitor (minimized)').checked).toBe(false);
    find(m, 'Monitor (minimized)').onSelect();
    expect(act.focus).toHaveBeenCalledWith('b');
  });

  it('View: zoom label follows the window state; Learn panel is a checkbox', () => {
    const w = win({ maximized: true });
    const { c } = ctx({ activeWindow: w, windows: [w], learnOpen: false });
    const v = buildMenus(c).view;
    expect(find(v, 'Exit Zoom')).toBeDefined();
    expect(find(v, 'Learn Mode Panel').checked).toBe(false);
  });

  it("the focused app's items come first in File and View, followed by the shell's own", () => {
    const save = vi.fn();
    const { c } = ctx({
      app: {
        file: [{ label: 'Save', onSelect: save }],
        view: [{ label: 'Show Hidden', checked: true, onSelect: vi.fn() }],
      },
    });
    const m = buildMenus(c);
    expect(labelled(m.file).map((i) => i.label)).toEqual([
      'Save',
      'New Terminal Window',
      'Close Window',
    ]);
    expect(m.file[1]).toEqual({ type: 'separator' });
    find(m.file, 'Save').onSelect();
    expect(save).toHaveBeenCalled();
    expect(labelled(m.view).map((i) => i.label)).toContain('Show Hidden');
    expect(labelled(m.view).map((i) => i.label)).toContain('Mission Control');
  });

  it('Edit: the app replaces the generic Copy; otherwise Copy needs a selection', () => {
    const undo = vi.fn();
    const own = buildMenus(ctx({ app: { edit: [{ label: 'Undo', onSelect: undo }] } }).c).edit;
    expect(labelled(own).map((i) => i.label)).toEqual(['Undo']);

    expect(find(buildMenus(ctx().c).edit, 'Copy').disabled).toBe(true);
    const { c, act } = ctx({ selectedText: 'hello' });
    const copy = find(buildMenus(c).edit, 'Copy');
    expect(copy.disabled).toBe(false);
    copy.onSelect();
    expect(act.copyText).toHaveBeenCalledWith('hello');
  });
});
