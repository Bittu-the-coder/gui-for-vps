import { WsMessageSchema, type ConnStatus } from '@gfv/shared';

/**
 * Subscribes to server-pushed connection statuses. Reconnects automatically
 * (e.g. if the dev server restarts). Returns a function that stops everything.
 */
export function startStatusSocket(
  onStatuses: (s: Record<string, ConnStatus>) => void,
  onLive: (live: boolean) => void = () => {},
): () => void {
  let ws: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = WsMessageSchema.safeParse(JSON.parse(String(e.data)));
        if (msg.success) onStatuses(msg.data.statuses);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onopen = () => onLive(true);
    ws.onclose = () => {
      if (stopped) return;
      onLive(false); // the GFV server went away: the desktop shows a banner until it is back
      timer = setTimeout(open, 2000);
    };
  };
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
