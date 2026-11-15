import {
  APPS,
  containerName,
  parseCredentials,
  parseInstalled,
  type AppDef,
  type AppsListing,
  type InstalledApp,
} from '@gfv/shared';
import { Eye, Globe, Play, RotateCw, Square, Store, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { openApp } from '../../desktop/openApp';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { useServers } from '../../stores/serverStore';
import { appById } from '../registry';

/** Curated Docker apps: pick one, see exactly what will run, install it. Everything goes through the Run dialog. */
export function AppStoreApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const server = useServers((s) => s.servers.find((x) => x.id === serverId));
  const [listing, setListing] = useState<AppsListing | null>(null);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState<AppDef | null>(null);
  const [creds, setCreds] = useState<{
    app: AppDef;
    items: { name: string; value: string }[];
  } | null>(null);

  const load = async () => {
    const r = await api.query(serverId!, 'apps.list');
    const problem = queryProblem(r.exitCode, r.stderr, 'docker');
    setError(problem ?? '');
    if (!problem) setListing(parseInstalled(r.stdout));
  };
  usePolling(load, 5000, active);

  if (!serverId) return <NoServer app="App Store" />;

  const byId = new Map<string, InstalledApp>(
    listing?.kind === 'ok' ? listing.apps.map((a) => [a.id, a]) : [],
  );
  const run = (actionId: string, params: object) =>
    requestRun({ serverId, actionId, params, onDone: () => void load() });
  const showCreds = async (app: AppDef) => {
    const r = await api.query(serverId, 'apps.credentials', { app: app.id });
    setCreds({ app, items: parseCredentials(r.stdout, app) });
  };

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <Store size={18} className="text-link" />
        <span className="font-medium">Apps you can run with one click</span>
      </div>
      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}
      {listing && listing.kind !== 'ok' && (
        <div
          data-testid="no-docker"
          className="m-2 rounded-xl border border-warning bg-warning/10 p-3"
        >
          <p className="font-medium">
            {listing.kind === 'no_docker'
              ? 'Docker is not installed on this server.'
              : 'The Docker service is not running.'}
          </p>
          <p className="text-footnote text-muted-foreground">
            {listing.kind === 'no_docker'
              ? 'The apps below run as Docker containers. Install Docker from the Dev Hub first.'
              : 'Start docker.service in the Services app, then come back.'}
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => openApp(appById(listing.kind === 'no_docker' ? 'devhub' : 'services')!)}
          >
            {listing.kind === 'no_docker' ? 'Open Dev Hub' : 'Open Services'}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <ul className="grid gap-2 sm:grid-cols-2">
          {APPS.map((app) => {
            const inst = byId.get(app.id);
            return (
              <li
                key={app.id}
                data-testid="store-app"
                data-app={app.id}
                className="flex flex-col rounded-xl border border-separator p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{app.name}</span>
                  {inst && (
                    <span
                      className={`rounded-full px-2 py-px text-caption ${inst.state === 'running' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}
                    >
                      {inst.state === 'running' ? 'running' : 'stopped'}
                    </span>
                  )}
                </div>
                <p className="text-footnote text-muted-foreground">{app.tagline}</p>
                <p className="mt-1 flex-1 text-footnote">{app.description}</p>
                {inst ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {inst.hostPort && (
                      <span className="mr-1 text-footnote text-muted-foreground">
                        port {inst.hostPort} ·{' '}
                        {inst.exposed ? 'open to the internet' : 'this server only'}
                      </span>
                    )}
                    {inst.state === 'running' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Stop ${app.name}`}
                        onClick={() => run('docker.stop', { name: containerName(app.id) })}
                      >
                        <Square size={12} /> Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Start ${app.name}`}
                        onClick={() => run('docker.start', { name: containerName(app.id) })}
                      >
                        <Play size={12} /> Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Restart ${app.name}`}
                      onClick={() => run('docker.restart', { name: containerName(app.id) })}
                    >
                      <RotateCw size={12} />
                    </Button>
                    {app.secrets.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => void showCreds(app)}>
                        <Eye size={12} /> Show credentials
                      </Button>
                    )}
                    {app.web && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Put a domain in front of it"
                        onClick={() => openApp(appById('network')!)}
                      >
                        <Globe size={12} /> Add a domain
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      aria-label={`Remove ${app.name}`}
                      onClick={() => run('apps.remove', { app: app.id, deleteData: false })}
                    >
                      <Trash2 size={12} /> Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="mt-2 self-start"
                    disabled={listing?.kind !== 'ok'}
                    onClick={() => setInstalling(app)}
                  >
                    Install…
                  </Button>
                )}
                {inst && inst.exposed && inst.hostPort && server && (
                  <p className="mt-1 text-footnote">
                    Reachable at{' '}
                    <code>
                      http://{server.host}:{inst.hostPort}
                    </code>{' '}
                    (if the firewall allows it)
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="p-3 text-footnote text-muted-foreground">
          Each app is one Docker container with its own data volume, pinned to a tested version.
          “Remove” keeps your data; delete the data only when you are sure (Docker app). Apps listen
          on this server only unless you choose to open the port.
        </p>
      </div>
      <CommandsDisclosure serverId={serverId} actions={[{ id: 'apps.list' }]} />
      {installing && (
        <InstallDialog
          app={installing}
          onClose={() => setInstalling(null)}
          onGo={(hostPort, expose) => {
            run('apps.install', { app: installing.id, hostPort, expose });
            setInstalling(null);
          }}
        />
      )}
      {creds && (
        <Dialog open onOpenChange={(o) => !o && setCreds(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{creds.app.name}: generated credentials</DialogTitle>
              <DialogDescription>
                Stored on the server in a file only you can read. Keep them somewhere safe.
              </DialogDescription>
            </DialogHeader>
            {creds.items.length === 0 && <p className="text-muted-foreground">Nothing found.</p>}
            {creds.items.map((c) => (
              <div key={c.name} className="flex flex-col gap-1">
                <Label>{c.name}</Label>
                <code
                  data-testid="credential"
                  className="rounded bg-sunken p-2 font-mono text-footnote select-all"
                >
                  {c.value}
                </code>
              </div>
            ))}
            <DialogFooter>
              <Button onClick={() => setCreds(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function InstallDialog({
  app,
  onClose,
  onGo,
}: {
  app: AppDef;
  onClose: () => void;
  onGo: (port: number, expose: boolean) => void;
}) {
  const [port, setPort] = useState(String(app.defaultHostPort));
  const [expose, setExpose] = useState(false);
  const n = Number(port);
  const bad = !Number.isInteger(n) || n < 1024 || n > 65535;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install {app.name}</DialogTitle>
          <DialogDescription>
            Image <code>{app.image}</code>. You will see the exact commands before anything runs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor="app-port">Port on this server</Label>
          <Input
            id="app-port"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          {bad && <p className="text-footnote text-danger">Use a port from 1024 to 65535.</p>}
        </div>
        <label className="flex items-start gap-2 text-footnote">
          <input
            type="checkbox"
            className="mt-1"
            checked={expose}
            onChange={(e) => setExpose(e.target.checked)}
          />
          <span>
            <b>Reachable from the internet.</b> Off (recommended): only this server can open it; put
            a domain with HTTPS in front using the Network app. On: anyone can try to reach port{' '}
            {port || '…'} unless a firewall blocks it.
          </span>
        </label>
        <p className="text-footnote text-muted-foreground">{app.after}</p>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={bad} onClick={() => onGo(n, expose)}>
            Review…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
