import { useDesktop } from '../../desktop/windowStore';

/** Opens a file in the Editor, or focuses the window that already has it open. */
export function openEditor(serverId: string, path: string): void {
  const desk = useDesktop.getState();
  const existing = Object.values(desk.windows).find(
    (w) => w.appId === 'editor' && w.serverId === serverId && w.arg === path,
  );
  if (existing) return desk.focus(existing.id);
  desk.open({
    appId: 'editor',
    title: path.split('/').pop() || path,
    w: 820,
    h: 560,
    serverId,
    arg: path,
  });
}
