import { useServers } from '../stores/serverStore';
import type { AppDef } from '../apps/registry';
import { useDesktop } from './windowStore';

/** The one way to open an app: handles singletons and ties server-bound apps to the active server. */
export function openApp(app: AppDef): void {
  const desk = useDesktop.getState();
  if (app.singleton) {
    const existing = Object.values(desk.windows).find((w) => w.appId === app.id);
    if (existing) return desk.focus(existing.id);
  }
  const serverId = app.serverBound ? (useServers.getState().activeId ?? undefined) : undefined;
  desk.open({ appId: app.id, title: app.title, ...app.defaultSize, serverId });
}
