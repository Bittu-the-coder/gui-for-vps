import type { ConnectResult, ConnStatus, Server } from '@gfv/shared';
import { useState } from 'react';
import { confirmDialog } from '../../components/confirmStore';
import { Button } from '../../components/ui/button';
import { openApp } from '../../desktop/openApp';
import { api, ApiError } from '../../lib/api';
import { useRecording } from '../../stores/recordingStore';
import { useServers } from '../../stores/serverStore';
import { toast } from '../../stores/toastStore';
import { appById } from '../registry';
import { HostKeyDialog, type HostKeyPrompt } from './HostKeyDialog';
import { ServerForm } from './ServerForm';

const STATUS_STYLE: Record<ConnStatus, { dot: string; label: string }> = {
  connected: { dot: 'bg-success', label: 'Connected' },
  connecting: { dot: 'bg-warning animate-pulse', label: 'Connecting…' },
  error: { dot: 'bg-danger', label: 'Error' },
  disconnected: { dot: 'bg-faint-foreground', label: 'Disconnected' },
};

function describe(r: ConnectResult): string {
  switch (r.status) {
    case 'connected':
      return 'Connected';
    case 'auth_failed':
      return 'Authentication failed — check the username and credentials.';
    case 'error':
      return `Could not connect: ${r.message}`;
    default:
      return 'Host key needs your approval.';
  }
}

export function ServersApp() {
  const { servers, statuses, activeId, setActive, refreshServers, refreshStatuses, refreshVault } =
    useServers();
  const [editing, setEditing] = useState<Server | 'new' | null>(null);
  const [prompt, setPrompt] = useState<HostKeyPrompt | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const note = (id: string, text: string) => setNotes((n) => ({ ...n, [id]: text }));

  /** Run an API call; a 423 means the vault locked underneath us, so go back to the unlock screen. */
  const guarded = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) return void refreshVault();
      note(id, e instanceof ApiError ? e.detail : 'Could not reach the GFV server.');
    } finally {
      setBusyId(null);
      void refreshStatuses();
    }
  };

  const handleResult = (server: Server, r: ConnectResult) => {
    if (r.status === 'host_key_unknown' || r.status === 'host_key_changed') {
      note(server.id, '');
      setPrompt({ server, result: r });
    } else note(server.id, describe(r));
  };

  const connect = (s: Server) =>
    guarded(s.id, async () => handleResult(s, await api.connect(s.id)));
  const test = (s: Server) => guarded(s.id, async () => handleResult(s, await api.test(s.id)));
  const disconnect = (s: Server) =>
    guarded(s.id, async () => {
      await api.disconnect(s.id);
      note(s.id, '');
    });
  const remove = (s: Server) => {
    void confirmDialog({
      title: `Delete "${s.name}"?`,
      body: 'Its saved credentials will be removed from GFV. The server itself is not touched.',
      confirmLabel: 'Delete',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      return guarded(s.id, async () => {
        await api.deleteServer(s.id);
        await refreshServers();
      });
    });
  };

  /** A recipe from what is installed on this server now (Dev Hub tools). */
  const clone = (s: Server) =>
    guarded(s.id, async () => {
      try {
        const r = await api.cloneServer(s.id);
        useRecording.setState({ justStopped: r.recipeId }); // the Recipes app opens it
        openApp(appById('recipes')!);
        toast({
          kind: 'success',
          title: `Created a recipe from ${s.name}`,
          body: `${r.tools.length} tool${r.tools.length === 1 ? '' : 's'}: ${r.tools.join(', ')}. Replay it on another server from Recipes.`,
        });
      } catch (e) {
        const code = e instanceof ApiError ? (e.body as { error?: string }).error : '';
        toast({
          kind: 'error',
          title: 'Could not clone this server',
          body:
            code === 'nothing_to_clone'
              ? 'No Dev Hub tools (Node, Python, Docker, PostgreSQL, nginx, Git) are installed on it.'
              : code === 'unsupported_os'
                ? 'Only Ubuntu, Debian, Fedora and RHEL-family servers can be cloned for now.'
                : code === 'not_connected'
                  ? 'Connect it first.'
                  : 'Something went wrong.',
        });
      }
    });

  const trust = (p: HostKeyPrompt) => {
    setPrompt(null);
    void guarded(p.server.id, async () => {
      await api.trustHostKey(
        p.server.id,
        p.result.fingerprint,
        p.result.status === 'host_key_changed',
      );
      handleResult(p.server, await api.connect(p.server.id));
    });
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Servers</h2>
        <Button size="sm" onClick={() => setEditing('new')}>
          + Add server
        </Button>
      </div>

      {servers.length === 0 ? (
        <p className="m-auto text-center text-muted-foreground">
          No servers yet.
          <br />
          Add one to get started.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {servers.map((s) => {
            const st = statuses[s.id] ?? 'disconnected';
            const style = STATUS_STYLE[st];
            const connected = st === 'connected';
            return (
              <li
                key={s.id}
                className="rounded-md border border-border border-l-4 bg-background p-3"
                style={{ borderLeftColor: s.color }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`}
                        aria-hidden
                      />
                      <span className="truncate">{s.name}</span>
                      {activeId === s.id && (
                        <span className="rounded bg-primary/10 px-1.5 text-[10px] text-link">
                          active
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.username}@{s.host}:{s.port} · {style.label}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {activeId !== s.id && (
                      <Button size="sm" variant="ghost" onClick={() => setActive(s.id)}>
                        Use
                      </Button>
                    )}
                    {connected ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === s.id}
                        onClick={() => disconnect(s)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busyId === s.id} onClick={() => connect(s)}>
                        Connect
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === s.id}
                      onClick={() => test(s)}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === s.id || statuses[s.id] !== 'connected'}
                      title="Create a recipe from the tools installed on this server"
                      onClick={() => void clone(s)}
                    >
                      Clone setup
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                      Delete
                    </Button>
                  </div>
                </div>
                {notes[s.id] && (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {notes[s.id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ServerForm
          open
          // key forces fresh form state when switching between add and different servers
          key={editing === 'new' ? 'new' : editing.id}
          server={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refreshServers();
          }}
        />
      )}
      <HostKeyDialog prompt={prompt} onTrust={trust} onCancel={() => setPrompt(null)} />
    </div>
  );
}
