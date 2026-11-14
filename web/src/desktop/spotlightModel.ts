import type { ActionInfo } from '@gfv/shared';
import type { AppDef } from '../apps/registry';
import { WALLPAPERS } from './wallpapers';
import type { WindowState } from './windowStore';

export type SpotlightGroup = 'Windows' | 'Apps' | 'Servers' | 'Commands' | 'Actions';

export interface SpotlightItem {
  id: string;
  group: SpotlightGroup;
  title: string;
  subtitle?: string;
  /** Extra words that should find this item ("dark" finds "Switch to Dark Mode"; "ssh" finds Servers). */
  keywords?: string;
  /** For app and window items: which app's icon to show. */
  appId?: string;
  /** A small tag on the right ("Active", "Open"). */
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

// --- Fuzzy matching -----------------------------------------------------------------------------

/** 0 = no match. Higher = better: exact > prefix > word start > substring > letters in order. */
function scoreOne(token: string, text: string): number {
  if (!token) return 1;
  const t = text.toLowerCase();
  if (t === token) return 100;
  if (t.startsWith(token)) return 90;
  if (t.split(/[\s\-_/.:]+/).some((w) => w.startsWith(token))) return 75;
  const at = t.indexOf(token);
  if (at >= 0) return 60 - Math.min(at, 30) * 0.5;
  // Letters in order ("trm" finds "Terminal"): weaker, and tighter is better.
  let pos = -1;
  let span = 0;
  for (const ch of token) {
    const next = t.indexOf(ch, pos + 1);
    if (next < 0) return 0;
    if (pos >= 0) span += next - pos - 1;
    pos = next;
  }
  return Math.max(5, 30 - span);
}

/** Every word of the query must match; the score is the average. */
export function fuzzyScore(query: string, text: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  let sum = 0;
  for (const tok of tokens) {
    const s = scoreOne(tok, text);
    if (s === 0) return 0;
    sum += s;
  }
  return sum / tokens.length;
}

const GROUP_ORDER: SpotlightGroup[] = ['Windows', 'Apps', 'Servers', 'Commands', 'Actions'];
const groupRank = (g: SpotlightGroup) => GROUP_ORDER.indexOf(g);

/** Items that match, best first. With no query: everything, grouped in a fixed order (capped). */
export function rankItems(items: SpotlightItem[], query: string, cap = 40): SpotlightItem[] {
  const q = query.trim();
  if (!q) {
    return [...items].sort((a, b) => groupRank(a.group) - groupRank(b.group)).slice(0, cap);
  }
  const scored = items
    .map((item, i) => {
      const s = Math.max(
        fuzzyScore(q, item.title),
        0.8 * fuzzyScore(q, item.keywords ?? ''),
        0.5 * fuzzyScore(q, item.subtitle ?? ''),
      );
      return { item, s, i };
    })
    .filter((x) => x.s > 0);
  scored.sort(
    (a, b) => b.s - a.s || groupRank(a.item.group) - groupRank(b.item.group) || a.i - b.i,
  );
  return scored.slice(0, cap).map((x) => x.item);
}

// --- Items --------------------------------------------------------------------------------------

export interface SpotlightCtx {
  launchable: AppDef[];
  windows: WindowState[];
  servers: { id: string; name: string; host: string }[];
  activeServerId: string | null;
  theme: 'light' | 'dark';
  wallpaper: string;
  reduceTransparency: boolean;
  learnOpen: boolean;
  recording: boolean;
  /** Runner actions that need no input (from GET /api/actions). */
  actions: ActionInfo[];
  act: {
    openApp: (app: AppDef) => void;
    focusWindow: (id: string) => void;
    setActiveServer: (id: string) => void;
    toggleTheme: () => void;
    setWallpaper: (id: string) => void;
    setReduceTransparency: (on: boolean) => void;
    toggleLearn: () => void;
    toggleRecording: () => void;
    missionControl: () => void;
    controlCenter: () => void;
    lock: () => void;
    changePassword: () => void;
    tour: () => void;
    runAction: (serverId: string, actionId: string) => void;
  };
}

export function buildSpotlightItems(c: SpotlightCtx): SpotlightItem[] {
  const { act } = c;
  const items: SpotlightItem[] = [];

  for (const w of c.windows) {
    items.push({
      id: `win:${w.id}`,
      group: 'Windows',
      title: w.title,
      subtitle: w.minimized ? 'Minimized window' : 'Open window',
      appId: w.appId,
      keywords: 'window switch focus',
      run: () => act.focusWindow(w.id),
    });
  }

  for (const a of c.launchable) {
    const running = c.windows.some((w) => w.appId === a.id);
    items.push({
      id: `app:${a.id}`,
      group: 'Apps',
      title: a.title,
      subtitle: running ? 'Bring to front' : 'Open',
      appId: a.id,
      hint: running ? 'Open' : undefined,
      keywords: 'app open launch',
      run: () => act.openApp(a),
    });
  }

  for (const s of c.servers) {
    const active = s.id === c.activeServerId;
    items.push({
      id: `srv:${s.id}`,
      group: 'Servers',
      title: `Switch to ${s.name}`,
      subtitle: s.host,
      hint: active ? 'Active' : undefined,
      keywords: `server ssh machine vps ${s.name}`,
      run: () => act.setActiveServer(s.id),
    });
  }

  const cmd = (
    id: string,
    title: string,
    run: () => void,
    keywords = '',
    extra?: Partial<SpotlightItem>,
  ) => items.push({ id: `cmd:${id}`, group: 'Commands', title, keywords, run, ...extra });

  cmd(
    'theme',
    c.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
    act.toggleTheme,
    'theme appearance dark light night day',
  );
  for (const w of WALLPAPERS) {
    cmd(`wp:${w.id}`, `Wallpaper: ${w.name}`, () => act.setWallpaper(w.id), 'background desktop', {
      hint: c.wallpaper === w.id ? 'Current' : undefined,
    });
  }
  cmd(
    'transparency',
    c.reduceTransparency ? 'Turn Transparency On' : 'Reduce Transparency',
    () => act.setReduceTransparency(!c.reduceTransparency),
    'blur glass vibrancy accessibility',
  );
  cmd(
    'learn',
    c.learnOpen ? 'Hide Learn Mode Panel' : 'Show Learn Mode Panel',
    act.toggleLearn,
    'learn journal commands teach',
  );
  cmd(
    'record',
    c.recording ? 'Stop Recording' : 'Start Recording',
    act.toggleRecording,
    'recipe record script export',
    { disabled: !c.recording && !c.activeServerId },
  );
  cmd('mission', 'Mission Control', act.missionControl, 'windows overview exposé');
  cmd('cc', 'Open Control Center', act.controlCenter, 'settings server theme');
  cmd('lock', 'Lock Vault', act.lock, 'security master password disconnect');
  cmd('pw', 'Change Master Password…', act.changePassword, 'security vault');
  cmd('tour', 'Take the Tour', act.tour, 'help onboarding guide');

  for (const a of c.actions) {
    items.push({
      id: `act:${a.id}`,
      group: 'Actions',
      title: `Run: ${a.title}`,
      subtitle: c.activeServerId
        ? `${a.risk} · on ${c.servers.find((s) => s.id === c.activeServerId)?.name ?? 'the active server'}`
        : 'Pick a server first',
      keywords: `${a.id} run command action ${a.explain}`,
      disabled: !c.activeServerId,
      run: () => c.activeServerId && act.runAction(c.activeServerId, a.id),
    });
  }

  return items;
}
