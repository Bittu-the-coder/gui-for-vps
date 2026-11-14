import { parseBackupHome, parseBackupJobs, type BackupJob } from '@gfv/shared';
import { Archive, Download, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CommandsDisclosure } from '../../components/CommandsDisclosure';
import { NoServer, queryProblem } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { confirmDialog } from '../../components/confirmStore';
import { useDesktop } from '../../desktop/windowStore';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';
import { BackupDialog } from './BackupDialog';

const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;

/** Scheduled backups: a real systemd timer on the server packs your folders into archives you can download or restore. */
export function BackupsApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const active = !!serverId && !win?.minimized;
  const [jobs, setJobs] = useState<BackupJob[] | null>(null);
  const [home, setHome] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const r = await api.query(serverId!, 'backup.list');
    const problem = queryProblem(r.exitCode, r.stderr, 'systemctl');
    setError(problem ?? '');
    if (!problem) {
      setJobs(parseBackupJobs(r.stdout));
      setHome(parseBackupHome(r.stdout) ?? '');
    }
  };
  usePolling(load, 10_000, active);

  if (!serverId) return <NoServer app="Backups" />;

  const run = (actionId: string, params: object) =>
    requestRun({ serverId, actionId, params, onDone: () => void load() });
  const remove = (j: BackupJob) =>
    void confirmDialog({
      title: `Stop the “${j.name}” backup?`,
      body: 'The timer and script are removed. Archives already made are kept.',
      confirmLabel: 'Review…',
    }).then((ok) => ok && run('backup.remove', { name: j.name }));
  const download = (j: BackupJob, name: string) => {
    const a = document.createElement('a');
    a.href = api.fsDownloadUrl(serverId, `${home}/.gfv/backups/${j.name}/${name}`);
    a.download = name;
    a.click();
  };

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <Archive size={18} className="text-link" />
        <span className="font-medium">Backups on this server</span>
        <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus size={13} /> New schedule
        </Button>
      </div>
      {error && (
        <p role="alert" className="p-3 text-danger">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {jobs && jobs.length === 0 && !error && (
          <p className="p-6 text-center text-muted-foreground">
            No backups yet. Schedule one: the server will pack the folders you choose into an
            archive every day or week.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {jobs?.map((j) => (
            <li
              key={j.name}
              data-testid="backup-job"
              className="rounded-xl border border-separator p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-title font-semibold">{j.name}</span>
                <span
                  className={`rounded-full px-2 py-px text-caption ${j.active ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}
                >
                  {j.active ? 'scheduled' : 'timer not running'}
                </span>
                {j.last === 'failed' && (
                  <span className="rounded-full bg-danger/10 px-2 py-px text-caption text-danger">
                    last run failed
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run('backup.run-now', { name: j.name })}
                  >
                    Back up now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => remove(j)}
                  >
                    Stop schedule
                  </Button>
                </span>
              </div>
              <p className="mt-1 text-footnote text-muted-foreground">
                {j.frequency === 'weekly' ? 'Every Monday' : 'Every day'} at{' '}
                {String(j.hour).padStart(2, '0')}:00 (server time) · keeps the newest {j.keep} ·{' '}
                {j.nextAt
                  ? `next run ${new Date(j.nextAt * 1000).toLocaleString()}`
                  : 'next run unknown'}
              </p>
              <p className="text-footnote text-muted-foreground">
                Folders: <code>{j.paths.join(', ')}</code>
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {j.archives.length === 0 && (
                  <li className="text-footnote text-muted-foreground">
                    No archive yet. Press “Back up now” to make the first one.
                  </li>
                )}
                {j.archives.map((a) => (
                  <li
                    key={a.name}
                    data-testid="backup-archive"
                    className="flex items-center gap-2 rounded-lg bg-sunken p-2 text-footnote"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {new Date(a.at * 1000).toLocaleString()} · {size(a.sizeBytes)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Download ${a.name}`}
                      onClick={() => download(j, a.name)}
                    >
                      <Download size={13} /> Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Restore ${a.name} into a folder`}
                      onClick={() => run('backup.restore', { name: j.name, archive: a.name })}
                    >
                      <RotateCcw size={13} /> Restore to a folder
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      aria-label={`Delete ${a.name}`}
                      onClick={() =>
                        run('backup.delete-archive', { name: j.name, archive: a.name })
                      }
                    >
                      <Trash2 size={13} />
                    </Button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="p-3 text-footnote text-muted-foreground">
          Archives are stored in <code>~/.gfv/backups</code> on this same server. Download them (or
          copy them to another server in Files) as well: a backup on the same disk does not survive
          the disk. Restoring unpacks into a new folder and never overwrites your live files.
        </p>
      </div>
      <CommandsDisclosure serverId={serverId} actions={[{ id: 'backup.list' }]} />
      {adding && (
        <BackupDialog
          serverId={serverId}
          onClose={() => setAdding(false)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
