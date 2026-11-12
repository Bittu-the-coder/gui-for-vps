import { parseDetect, TOOLS, type DevHubStatus, type ToolDef } from '@gfv/shared';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { activeKey, requestRun, useRunDialog } from '../../runner/runStore';

export function DevHubApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const running = useRunDialog((s) => s.active);
  const [status, setStatus] = useState<DevHubStatus | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const r = await api.query(serverId!, 'devhub.detect');
    const problem = queryProblem(r.exitCode, r.stderr, 'the tool check');
    setError(problem ?? '');
    if (!problem) setStatus(parseDetect(r.stdout));
  };
  usePolling(load, 6000, active);

  if (!serverId) return <NoServer app="Dev Hub" />;

  const go = (actionId: string, resumeRunId?: string) =>
    requestRun({ serverId, actionId, params: {}, resumeRunId, onDone: () => void load() });
  const unitAct = (verb: 'start' | 'stop', unit: string) =>
    requestRun({
      serverId,
      actionId: `service.${verb}`,
      params: { unit },
      onDone: () => void load(),
    });

  const card = (t: ToolDef) => {
    const st = status?.tools[t.id];
    const installing = running[activeKey(serverId, `devhub.install.${t.id}`)];
    const removing = running[activeKey(serverId, `devhub.uninstall.${t.id}`)];
    const busy = installing ?? removing;
    const supported = status?.os.supported ?? false;
    return (
      <div
        key={t.id}
        data-testid={`tool-${t.id}`}
        className="flex flex-col gap-2 rounded border border-border p-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl">{t.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{t.name}</div>
            <div className="text-xs text-muted-foreground" data-testid={`status-${t.id}`}>
              {busy
                ? installing
                  ? 'Installing…'
                  : 'Removing…'
                : !status
                  ? 'Checking…'
                  : st?.installed
                    ? `Installed · v${st.version}${st.running === undefined ? '' : st.running ? ' · running' : ' · stopped'}`
                    : 'Not installed'}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t.description}</p>
        <div className="mt-auto flex flex-wrap gap-1.5">
          {busy ? (
            <Button
              size="sm"
              onClick={() =>
                go(installing ? `devhub.install.${t.id}` : `devhub.uninstall.${t.id}`, busy.runId)
              }
            >
              View output
            </Button>
          ) : st?.installed ? (
            <>
              {t.unit &&
                st.running !== undefined &&
                (st.running ? (
                  <Button size="sm" variant="outline" onClick={() => unitAct('stop', t.unit!)}>
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => unitAct('start', t.unit!)}>
                    Start
                  </Button>
                ))}
              <Button size="sm" variant="outline" onClick={() => go(`devhub.uninstall.${t.id}`)}>
                Uninstall
              </Button>
              {t.id === 'postgresql' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500"
                  onClick={() => go('devhub.purge.postgresql')}
                >
                  Uninstall + delete databases…
                </Button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              disabled={!status || !supported}
              onClick={() => go(`devhub.install.${t.id}`)}
            >
              Install
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error && (
          <p role="alert" className="mb-2 text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {status && !status.os.supported && (
          <p
            role="alert"
            className="mb-3 rounded border border-amber-500 bg-amber-500/10 p-2 text-xs"
          >
            This server runs {status.os.pretty}. The Dev Hub can only install tools on Ubuntu and
            Debian for now, so installs are turned off. You can still see what is installed.
          </p>
        )}
        {status?.os.supported && (
          <p className="mb-2 text-xs text-muted-foreground">Detected {status.os.pretty}.</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{TOOLS.map(card)}</div>
      </div>
      <CommandsDisclosure serverId={serverId} actions={[{ id: 'devhub.detect' }]} />
    </div>
  );
}
