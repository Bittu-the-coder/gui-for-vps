import { useEffect, useState } from 'react';
import { LAUNCHABLE, appById } from '../apps/registry';
import { Tour } from '../tour/Tour';
import { tourSeen, useTour } from '../tour/tourStore';
import { useServers } from '../stores/serverStore';
import { LearnPanel } from '../learn/LearnPanel';
import { RunDialogHost } from '../runner/RunDialog';
import { useLearn } from '../stores/learnStore';
import { openApp } from './openApp';
import { Taskbar } from './Taskbar';
import { Window } from './Window';
import { useDesktop } from './windowStore';

export function Desktop() {
  const windows = useDesktop((s) => s.windows);
  const close = useDesktop((s) => s.close);
  const learnOpen = useLearn((s) => s.open);
  const noServers = useServers((s) => s.servers.length === 0);
  const live = useServers((s) => s.live);
  const startTour = useTour((s) => s.start);

  // First visit: walk the user through the desktop once.
  useEffect(() => {
    if (!tourSeen()) startTour();
  }, [startTour]);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);

  // Windows saved from an older version may belong to apps that no longer exist.
  useEffect(() => {
    for (const w of Object.values(useDesktop.getState().windows)) {
      if (!appById(w.appId)) close(w.id);
    }
  }, [close]);

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-gradient-to-br from-sky-200 to-indigo-300 text-slate-900 dark:from-slate-900 dark:to-indigo-950 dark:text-slate-100"
      onContextMenu={(e) => {
        e.preventDefault();
        setCtx({ x: e.clientX, y: e.clientY });
      }}
      onMouseDown={() => setCtx(null)}
    >
      {/* The workspace shrinks when the Learn panel is docked, so windows never hide under it. */}
      <div className="absolute bottom-0 left-0 top-0" style={{ right: learnOpen ? '20rem' : 0 }}>
        <div className="absolute left-3 top-3 flex flex-col gap-3">
          {LAUNCHABLE.map((a) => (
            <button
              key={a.id}
              data-tour={`app-${a.id}`}
              className="flex w-20 flex-col items-center gap-1 rounded p-2 text-xs hover:bg-white/30"
              onDoubleClick={() => openApp(a)}
            >
              <span className="text-3xl">{a.icon}</span>
              {a.title}
            </button>
          ))}
        </div>

        {noServers && (
          <div className="absolute left-1/2 top-1/3 w-80 -translate-x-1/2 rounded-lg border border-slate-300 bg-white/90 p-5 text-center shadow-xl dark:border-slate-700 dark:bg-slate-900/90">
            <p className="text-lg font-semibold">Add your first server</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Connect a VPS over SSH to open a terminal, browse files and install tools on it.
            </p>
            <button
              className="mt-3 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
              onClick={() => openApp(appById('servers')!)}
            >
              Add a server
            </button>
          </div>
        )}

        {Object.values(windows).map((w) => (
          <Window key={w.id} win={w} />
        ))}

        {ctx && (
          <div
            className="absolute z-[99999] rounded border border-slate-300 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={{ left: ctx.x, top: ctx.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {LAUNCHABLE.map((a) => (
              <button
                key={a.id}
                className="block w-full rounded px-3 py-1 text-left hover:bg-slate-200 dark:hover:bg-slate-800"
                onClick={() => {
                  openApp(a);
                  setCtx(null);
                }}
              >
                Open {a.title}
              </button>
            ))}
          </div>
        )}
      </div>
      {learnOpen && <LearnPanel />}
      <RunDialogHost />
      <Tour />
      {!live && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-[250000] bg-red-600 px-3 py-1.5 text-center text-sm text-white"
        >
          Lost the connection to GFV. Trying to reconnect… (is it still running?)
        </div>
      )}
      <Taskbar />
    </div>
  );
}
