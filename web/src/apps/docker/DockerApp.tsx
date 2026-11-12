import { parseContainers, parseImages, type ContainerInfo, type ImageInfo } from '@gfv/shared';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { LogPanel } from '../../components/LogPanel';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { requestRun } from '../../runner/runStore';

export function DockerApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [tab, setTab] = useState<'containers' | 'images'>('containers');
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [logName, setLogName] = useState<string | null>(null);

  const load = async () => {
    const r = await api.query(serverId!, tab === 'containers' ? 'docker.list' : 'docker.images');
    const problem = queryProblem(r.exitCode, r.stderr, 'Docker');
    setError(problem ?? '');
    if (!problem) {
      if (tab === 'containers') setContainers(parseContainers(r.stdout));
      else setImages(parseImages(r.stdout));
    }
    setLoaded(true);
  };
  usePolling(load, tab === 'containers' ? 5000 : 10000, active);

  if (!serverId) return <NoServer app="Docker" />;

  const act = (verb: string, name: string) =>
    requestRun({
      serverId,
      actionId: `docker.${verb}`,
      params: { name },
      onDone: () => void load(),
    });
  const b = 'h-6 px-1.5 text-[11px]';
  const tabBtn = (id: typeof tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      className={cn(
        'rounded-t px-3 py-1',
        tab === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
      )}
      onClick={() => {
        setTab(id);
        setLoaded(false);
        setError('');
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col text-sm">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-1 pt-1 text-xs">
        {tabBtn('containers', 'Containers')}
        {tabBtn('images', 'Images')}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="p-4 text-center">
            <p role="alert" className="text-red-600 dark:text-red-400">
              {error}
            </p>
            {/not installed/.test(error) && (
              <p className="mt-1 text-xs text-muted-foreground">
                The Dev Hub will be able to install it for you.
              </p>
            )}
          </div>
        )}
        {!loaded && !error && <p className="p-3 text-muted-foreground">Loading…</p>}
        {!error && loaded && tab === 'containers' && containers.length === 0 && (
          <p className="p-4 text-center text-muted-foreground">No containers on this server.</p>
        )}
        {!error && tab === 'containers' && (
          <table className="w-full table-fixed text-xs">
            <tbody>
              {containers.map((c) => (
                <tr
                  key={c.id}
                  data-testid="container-row"
                  className="border-b border-border/50 hover:bg-accent"
                >
                  <td className="w-5 px-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${c.state === 'running' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                      title={c.state}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-muted-foreground">
                      {c.image} · {c.status}
                      {c.ports ? ` · ${c.ports}` : ''}
                    </div>
                  </td>
                  <td className="w-72 px-1 text-right">
                    {c.state === 'running' ? (
                      <Button variant="outline" className={b} onClick={() => act('stop', c.name)}>
                        Stop
                      </Button>
                    ) : (
                      <Button variant="outline" className={b} onClick={() => act('start', c.name)}>
                        Start
                      </Button>
                    )}{' '}
                    <Button variant="outline" className={b} onClick={() => act('restart', c.name)}>
                      Restart
                    </Button>{' '}
                    <Button
                      variant="outline"
                      className={cn(b, 'text-red-500')}
                      disabled={c.state === 'running'}
                      title={c.state === 'running' ? 'Stop it first' : undefined}
                      onClick={() => act('rm', c.name)}
                    >
                      Remove
                    </Button>{' '}
                    <Button variant="ghost" className={b} onClick={() => setLogName(c.name)}>
                      Logs
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!error && tab === 'images' && (
          <table className="w-full table-fixed text-xs">
            <tbody>
              {images.map((i) => (
                <tr
                  key={i.id}
                  data-testid="image-row"
                  className="border-b border-border/50 hover:bg-accent"
                >
                  <td className="px-2 py-1">
                    <div className="truncate font-medium">
                      {i.repository}:{i.tag}
                    </div>
                    <div className="text-muted-foreground">
                      {i.size} · {i.created}
                    </div>
                  </td>
                  <td className="w-24 px-1 text-right">
                    <Button
                      variant="outline"
                      className={cn(b, 'text-red-500')}
                      onClick={() => act('rmi', i.id)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {logName && (
        <LogPanel
          serverId={serverId}
          actionId="docker.logs"
          params={{ name: logName }}
          title={logName}
          tool="Docker"
          active={active}
          onClose={() => setLogName(null)}
        />
      )}
      <CommandsDisclosure
        serverId={serverId}
        actions={[
          { id: 'docker.list' },
          { id: 'docker.images' },
          { id: 'docker.logs', params: { name: 'web' } },
        ]}
      />
    </div>
  );
}
