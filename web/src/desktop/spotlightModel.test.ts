import { describe, expect, it, vi } from 'vitest';
import { APPS } from '../apps/registry';
import { buildSpotlightItems, fuzzyScore, rankItems, type SpotlightCtx } from './spotlightModel';

describe('fuzzyScore', () => {
  it('ranks exact > prefix > word start > substring > letters in order', () => {
    const exact = fuzzyScore('files', 'Files');
    const prefix = fuzzyScore('fil', 'Files');
    const word = fuzzyScore('hub', 'Dev Hub');
    const sub = fuzzyScore('erm', 'Terminal');
    const loose = fuzzyScore('trm', 'Terminal');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThan(0);
  });
  it('is 0 when something does not match', () => {
    expect(fuzzyScore('xyz', 'Terminal')).toBe(0);
    expect(fuzzyScore('lt', 'Terminal')).toBe(0); // letters present but not in order
  });
  it('needs every word of the query to match', () => {
    expect(fuzzyScore('dark mode', 'Switch to Dark Mode')).toBeGreaterThan(0);
    expect(fuzzyScore('dark zebra', 'Switch to Dark Mode')).toBe(0);
  });
  it('ignores case and surrounding spaces', () => {
    expect(fuzzyScore('  TERM ', 'terminal')).toBeGreaterThan(0);
  });
});

function ctx(over: Partial<SpotlightCtx> = {}) {
  const act = {
    openApp: vi.fn(),
    focusWindow: vi.fn(),
    setActiveServer: vi.fn(),
    toggleTheme: vi.fn(),
    setWallpaper: vi.fn(),
    setReduceTransparency: vi.fn(),
    toggleLearn: vi.fn(),
    toggleRecording: vi.fn(),
    missionControl: vi.fn(),
    toggleFullscreen: vi.fn(),
    controlCenter: vi.fn(),
    lock: vi.fn(),
    changePassword: vi.fn(),
    tour: vi.fn(),
    runAction: vi.fn(),
  };
  const c: SpotlightCtx = {
    launchable: APPS.filter((a) => !a.hidden),
    windows: [],
    servers: [
      { id: 's1', name: 'vps-a', host: '10.0.0.1' },
      { id: 's2', name: 'prod', host: 'example.com' },
    ],
    activeServerId: 's1',
    theme: 'light',
    wallpaper: 'aurora',
    reduceTransparency: false,
    learnOpen: true,
    fullscreen: false,
    recording: false,
    actions: [
      {
        id: 'system.uptime',
        title: 'Show uptime',
        explain: 'How long it has been up',
        risk: 'safe',
        fields: [],
      },
    ] as SpotlightCtx['actions'],
    act,
    ...over,
  };
  return { c, act, items: buildSpotlightItems(c) };
}
const top = (items: ReturnType<typeof rankItems>) => items[0]?.id;

describe('buildSpotlightItems + rankItems', () => {
  it('typing an app name finds it first, and running it opens the app', () => {
    const { items, act } = ctx();
    const r = rankItems(items, 'term');
    expect(top(r)).toBe('app:terminal');
    r[0]!.run();
    expect(act.openApp).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal' }));
  });

  it('"dark" finds the theme command, and its title follows the current theme', () => {
    expect(top(rankItems(ctx().items, 'dark'))).toBe('cmd:theme');
    expect(ctx({ theme: 'dark' }).items.find((i) => i.id === 'cmd:theme')!.title).toBe(
      'Switch to Light Mode',
    );
  });

  it('finds servers by name and by host, and marks the active one', () => {
    const { items, act } = ctx();
    expect(top(rankItems(items, 'prod'))).toBe('srv:s2');
    expect(top(rankItems(items, 'example.com'))).toBe('srv:s2');
    expect(items.find((i) => i.id === 'srv:s1')!.hint).toBe('Active');
    rankItems(items, 'prod')[0]!.run();
    expect(act.setActiveServer).toHaveBeenCalledWith('s2');
  });

  it('lists open windows first when nothing is typed', () => {
    const { items } = ctx({
      windows: [
        {
          id: 'w1',
          appId: 'files',
          title: 'Files',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          z: 1,
          minimized: false,
          maximized: false,
        },
      ],
    });
    expect(rankItems(items, '')[0]!.id).toBe('win:w1');
  });

  it('runner actions are disabled without an active server and run on the active one otherwise', () => {
    const none = ctx({ activeServerId: null });
    expect(none.items.find((i) => i.id === 'act:system.uptime')!.disabled).toBe(true);
    const { items, act } = ctx();
    const item = items.find((i) => i.id === 'act:system.uptime')!;
    expect(item.disabled).toBe(false);
    item.run();
    expect(act.runAction).toHaveBeenCalledWith('s1', 'system.uptime');
  });

  it('Start Recording needs a server; Stop Recording does not', () => {
    expect(ctx({ activeServerId: null }).items.find((i) => i.id === 'cmd:record')!.disabled).toBe(
      true,
    );
    const stop = ctx({ activeServerId: null, recording: true }).items.find(
      (i) => i.id === 'cmd:record',
    )!;
    expect(stop.title).toBe('Stop Recording');
    expect(stop.disabled).toBe(false);
  });

  it('returns nothing for gibberish', () => {
    expect(rankItems(ctx().items, 'qzxjv')).toEqual([]);
  });
});
