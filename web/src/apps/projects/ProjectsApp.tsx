import { PROJECTS_DIR, parseProjects, unitName, type ProjectInfo } from '@gfv/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { LogPanel } from '../../components/LogPanel';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { DeployDialog, EnvDialog, ServiceDialog } from './Dialogs';

const dot = (p: ProjectInfo) =>
  p.active === 'active'
    ? 'bg-success'
    : p.active === 'failed'
      ? 'bg-danger'
      : 'bg-faint-foreground';

/** Apps deployed from git: update them, give them environment variables, and run them as services. */
export function ProjectsApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'deploy'; project?: ProjectInfo }
    | { kind: 'env'; project: ProjectInfo }
    | { kind: 'service'; project: ProjectInfo }
    | null
  >(null);
  const [logs, setLogs] = useState<string | null>(null);

  const load = async () => {
    const r = await api.query(serverId!, 'projects.list');
    const problem = queryProblem(r.exitCode, r.stderr, 'git');
    setError(problem ?? '');
    if (!problem) setProjects(parseProjects(r.stdout));
    setLoaded(true);
  };
  usePolling(load, 5000, active);
  if (!serverId) return <NoServer app="Projects" />;

  const run = (actionId: string, params: object) =>
    requestRun({ serverId, actionId, params, onDone: () => void load() });

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <span className="text-footnote text-muted-foreground">Folder: ~/{PROJECTS_DIR}</span>
        <Button size="sm" className="ml-auto" onClick={() => setDialog({ kind: 'deploy' })}>
          <Plus size={13} /> New project
        </Button>
      </div>
      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loaded && projects.length === 0 && !error && (
          <p className="p-6 text-center text-muted-foreground">
            No projects yet. Press <b>New project</b> to deploy an app from a git repository.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li
              key={p.name}
              data-testid="project-card"
              className="rounded-xl border border-separator bg-background p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${dot(p)}`}
                  title={`service: ${p.active}`}
                />
                <span className="text-title font-semibold">{p.name}</span>
                <code className="text-caption text-muted-foreground">
                  {p.branch}
                  {p.head ? ` @ ${p.head}` : ''}
                </code>
                {p.behind ? (
                  <span className="rounded-full bg-warning/10 px-2 text-caption text-warning">
                    {p.behind} new commit{p.behind === 1 ? '' : 's'}
                  </span>
                ) : null}
                {p.hasEnv && (
                  <span className="rounded-full bg-foreground/10 px-2 text-caption text-muted-foreground">
                    .env
                  </span>
                )}
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => setDialog({ kind: 'deploy', project: p })}>
                    Deploy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run('projects.fetch', { name: p.name })}
                  >
                    Check for updates
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog({ kind: 'env', project: p })}
                  >
                    Environment…
                  </Button>
                </span>
              </div>
              <p className="mt-1 truncate text-footnote text-muted-foreground" title={p.repo}>
                {p.repo}
                {p.build ? ` · build: ${p.build}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {!p.hasUnit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog({ kind: 'service', project: p })}
                  >
                    Run as a service…
                  </Button>
                ) : (
                  <>
                    {(['start', 'stop', 'restart'] as const).map((verb) => (
                      <Button
                        key={verb}
                        size="sm"
                        variant="outline"
                        onClick={() => run(`service.${verb}`, { unit: unitName(p.name) })}
                      >
                        {verb[0]!.toUpperCase() + verb.slice(1)}
                      </Button>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setLogs(p.name)}>
                      Logs
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ kind: 'service', project: p })}
                    >
                      Change start command…
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-danger"
                  onClick={() => run('projects.remove', { name: p.name })}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {logs && (
          <div className="mt-3 h-64 overflow-hidden rounded-xl border border-separator">
            <LogPanel
              serverId={serverId}
              actionId="services.logs"
              params={{ unit: unitName(logs), lines: 200 }}
              title={`${logs} logs`}
              tool="journalctl"
              active={active}
              onClose={() => setLogs(null)}
            />
          </div>
        )}
      </div>
      <CommandsDisclosure serverId={serverId} actions={[{ id: 'projects.list' }]} />
      {dialog?.kind === 'deploy' && (
        <DeployDialog
          serverId={serverId}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      )}
      {dialog?.kind === 'env' && (
        <EnvDialog
          serverId={serverId}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      )}
      {dialog?.kind === 'service' && (
        <ServiceDialog
          serverId={serverId}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
