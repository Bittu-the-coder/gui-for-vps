import { Rnd } from 'react-rnd';
import { appById } from '../apps/registry';
import { AppIcon } from '../components/icons/AppIcon';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useServers } from '../stores/serverStore';
import { tryClose, useDesktop, type WindowState } from './windowStore';

const TASKBAR_H = 44;

export function Window({ win }: { win: WindowState }) {
  const { focus, minimize, toggleMaximize, move, resize, focusedId } = useDesktop();
  const server = useServers((s) => s.servers.find((x) => x.id === win.serverId));
  const app = appById(win.appId);
  if (!app) return null;
  const App = app.component;
  const focused = focusedId === win.id;

  // Maximized = a CSS-level override. The stored x/y/w/h stay untouched,
  // so restoring is trivial and react-rnd's drag is just disabled.
  const rect = win.maximized
    ? { x: 0, y: 0, width: '100%', height: `calc(100% - ${TASKBAR_H}px)` }
    : { x: win.x, y: win.y, width: win.w, height: win.h };

  // A window tied to a server gets that server's colour as its border, so you can always
  // tell which machine a window talks to. Unfocused windows keep the colour but dimmed.
  const border = server ? { borderColor: server.color, opacity: focused ? 1 : 0.92 } : undefined;

  return (
    <Rnd
      position={{ x: rect.x, y: rect.y }}
      size={{ width: rect.width, height: rect.height }}
      minWidth={200}
      minHeight={120}
      bounds="parent"
      dragHandleClassName="win-titlebar"
      disableDragging={win.maximized}
      enableResizing={!win.maximized}
      onMouseDown={() => focus(win.id)}
      onDragStop={(_e, d) => move(win.id, d.x, d.y)}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        resize(win.id, ref.offsetWidth, ref.offsetHeight, pos.x, pos.y)
      }
      style={{ zIndex: win.z, display: win.minimized ? 'none' : undefined }}
    >
      <div
        className={`flex h-full flex-col overflow-hidden rounded-lg border-2 bg-white text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100 ${
          server ? '' : focused ? 'border-sky-500' : 'border-slate-300 dark:border-slate-700'
        }`}
        style={border}
      >
        <div
          className="win-titlebar flex h-8 shrink-0 select-none items-center justify-between bg-slate-100 px-2 text-xs dark:bg-slate-800"
          onDoubleClick={() => toggleMaximize(win.id)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <AppIcon app={app} size={16} />
            <span className="truncate">{win.title}</span>
            {server && (
              <span
                className="truncate rounded px-1.5 py-px text-[10px] font-medium text-white"
                style={{ background: server.color }}
                title={`${server.username}@${server.host}`}
              >
                {server.name}
              </span>
            )}
          </span>
          <span className="flex gap-1">
            <button
              aria-label="Minimize"
              className="px-2 hover:bg-slate-300/60 dark:hover:bg-slate-600/60"
              onClick={() => minimize(win.id)}
            >
              ─
            </button>
            <button
              aria-label="Maximize"
              className="px-2 hover:bg-slate-300/60 dark:hover:bg-slate-600/60"
              onClick={() => toggleMaximize(win.id)}
            >
              ▢
            </button>
            <button
              aria-label="Close"
              className="px-2 hover:bg-red-500 hover:text-white"
              onClick={() => tryClose(win.id)}
            >
              ✕
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ErrorBoundary>
            <App windowId={win.id} />
          </ErrorBoundary>
        </div>
      </div>
    </Rnd>
  );
}
