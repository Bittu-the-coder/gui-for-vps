import { confirmDialog } from '../../components/confirmStore';
import { BackBar } from '../../components/BackBar';
import { useCompact } from '../../desktop/compact';
import { RefreshCw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { NoServer } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { useDesktop } from '../../desktop/windowStore';
import { api, type SnapshotRow } from '../../lib/api';
import { cn } from '../../lib/utils';
import { requestRun } from '../../runner/runStore';

// The diff view shares Monaco with the Editor and only downloads when first needed.
const MonacoDiff = lazy(() => import('../editor/MonacoDiff'));

const SOURCE: Record<string, string> = {
  'files.write-root': 'Saved as administrator',
  'files.restore-snapshot': 'Before a restore',
};
const sourceLabel = (s: SnapshotRow) => (s.source ? (SOURCE[s.source] ?? s.source) : 'Editor save');

type Mode = 'current' | 'previous';
interface Loaded {
  original: string;
  modified: string;
  note?: string;
}

/** Timeline of the backups GFV made before changing files: see what changed, restore with one click. */
export function SnapshotsApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const dark = useDesktop((s) => s.theme) === 'dark';
  const serverId = win?.serverId;
  const compact = useCompact();
  const [rows, setRows] = useState<SnapshotRow[] | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('current');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [diffError, setDiffError] = useState('');

  const load = useCallback(async () => {
    if (!serverId) return;
    try {
      setRows(await api.snapshots(serverId));
      setError('');
    } catch {
      setError('Could not load the snapshots.');
    }
  }, [serverId]);
  useEffect(() => void load(), [load]);

  const groups = useMemo(() => {
    const m = new Map<string, SnapshotRow[]>();
    for (const r of rows ?? []) m.set(r.path, [...(m.get(r.path) ?? []), r]); // rows are newest first
    return [...m.entries()];
  }, [rows]);

  const selected = rows?.find((r) => r.id === selectedId);
  // The snapshot made just before this one, for the same file (older = later in the list).
  const previous = useMemo(() => {
    if (!selected) return undefined;
    const same = (rows ?? []).filter((r) => r.path === selected.path);
    return same[same.findIndex((r) => r.id === selected.id) + 1];
  }, [rows, selected]);

  useEffect(() => {
    if (!selected || !serverId) return setLoaded(null);
    let cancelled = false;
    setDiffError('');
    const text = async (path: string): Promise<{ text: string; missing?: boolean } | null> => {
      try {
        const r = await api.fsRead(serverId, path);
        return r.kind === 'text' ? { text: r.content } : null;
      } catch {
        return { text: '', missing: true };
      }
    };
    void (async () => {
      const snap = await text(selected.remotePath);
      const other =
        mode === 'previous' && previous
          ? await text(previous.remotePath)
          : await text(selected.path);
      if (cancelled) return;
      if (!snap || !other) return setDiffError('This file is binary or too large to compare here.');
      if (mode === 'previous' && previous) {
        setLoaded({
          original: other.text,
          modified: snap.text,
          note: 'Previous backup → this backup',
        });
      } else {
        setLoaded({
          original: snap.text,
          modified: other.text,
          note: other.missing
            ? 'The file no longer exists: showing everything as removed.'
            : 'This backup → the file now',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, mode, previous, serverId]);

  if (!serverId) return <NoServer app="Snapshots" />;

  const restore = (s: SnapshotRow) =>
    requestRun({
      serverId,
      actionId: 'files.restore-snapshot',
      params: { path: s.path, snapshot: s.remotePath },
      onDone: () => {
        void load();
        setMode('current');
      },
    });

  return (
    <div className="flex h-full text-sm">
      <div
        className={
          compact
            ? `min-w-0 flex-1 overflow-auto ${selectedId ? 'hidden' : ''}`
            : 'w-64 shrink-0 overflow-auto border-r border-border'
        }
      >
        <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
          <span>{rows ? `${rows.length} backups` : 'Loading…'}</span>
          <button
            className="hover:text-foreground"
            onClick={() => void load()}
            aria-label="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        {error && (
          <p role="alert" className="px-2 text-danger">
            {error}
          </p>
        )}
        {rows && rows.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            No backups yet. GFV makes one whenever it overwrites a file under /etc or saves a file
            as administrator (Editor → Save with sudo).
          </p>
        )}
        {groups.map(([path, list]) => (
          <div key={path} className="border-t border-border/60">
            <div className="truncate px-2 py-1 font-mono text-xs font-semibold" title={path}>
              {path}
            </div>
            {list.map((s) => (
              <button
                key={s.id}
                data-testid="snapshot-row"
                className={cn(
                  'block w-full px-3 py-1 text-left text-xs hover:bg-accent',
                  selectedId === s.id && 'bg-primary/15',
                )}
                onClick={() => {
                  setSelectedId(s.id);
                  setMode('current');
                }}
              >
                <div>{new Date(s.createdAt).toLocaleString()}</div>
                <div className="text-muted-foreground">
                  {sourceLabel(s)} · {s.sizeBytes} B
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className={`min-w-0 flex-1 flex-col ${compact && !selectedId ? 'hidden' : 'flex'}`}>
        {compact && selectedId && (
          <BackBar label="All backups" onBack={() => setSelectedId(null)} />
        )}
        {!selected ? (
          <div className="grid flex-1 place-items-center p-4 text-center text-muted-foreground">
            Pick a backup to see what changed since.
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono" title={selected.path}>
                {selected.path}
              </span>
              <select
                aria-label="Compare"
                className="h-7 rounded border border-input bg-transparent px-1"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="current">Compare with the file now</option>
                <option value="previous" disabled={!previous}>
                  Compare with the previous backup
                </option>
              </select>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => {
                  void confirmDialog({
                    title: 'Delete this backup?',
                    body: 'This cannot be undone.',
                    confirmLabel: 'Delete',
                    danger: true,
                  }).then((ok) => {
                    if (!ok) return;
                    return api.deleteSnapshot(serverId, selected.id).then(() => {
                      setSelectedId(null);
                      return load();
                    });
                  });
                }}
              >
                Delete backup
              </Button>
              <Button size="sm" onClick={() => restore(selected)}>
                Restore this version…
              </Button>
            </div>
            {loaded?.note && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{loaded.note}</p>
            )}
            <div className="min-h-0 flex-1" data-testid="diff-pane">
              {diffError ? (
                <p role="alert" className="p-3">
                  {diffError}
                </p>
              ) : loaded ? (
                <Suspense fallback={<div className="p-3 text-xs">Loading diff…</div>}>
                  <MonacoDiff
                    modelKey={`${selected.id}-${mode}${selected.path}`}
                    original={loaded.original}
                    modified={loaded.modified}
                    dark={dark}
                  />
                </Suspense>
              ) : (
                <p className="p-3 text-muted-foreground">Loading…</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
