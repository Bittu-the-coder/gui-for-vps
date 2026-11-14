import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  File,
  Folder,
  House,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { TRANSFER_MIME, TransferPayloadSchema, type FileEntry } from '@gfv/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, type MenuItem } from '../../components/menu/Menu';
import { PromptDialog, type PromptSpec } from '../../components/PromptDialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAppMenus } from '../../desktop/appMenus';
import { useDesktop } from '../../desktop/windowStore';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { requestRun } from '../../runner/runStore';
import { toast } from '../../stores/toastStore';
import { openEditor } from '../editor/openEditor';
import { formatSize, joinPath, nameError, parentPath } from './paths';

type SortKey = 'name' | 'size' | 'mtime';

function EntryIcon({ type }: { type: FileEntry['type'] }) {
  const cls = 'mr-1.5 inline shrink-0 -mt-0.5';
  if (type === 'dir') return <Folder size={14} className={`${cls} text-link`} />;
  if (type === 'symlink') return <Link2 size={14} className={`${cls} text-muted-foreground`} />;
  return <File size={14} className={`${cls} text-muted-foreground`} />;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.body as { error?: string })?.error;
    if (code === 'not_connected')
      return 'This server is not connected. Connect it in the Servers app.';
    if (code === 'permission_denied') return 'Permission denied: your SSH user cannot access this.';
    if (code === 'not_found') return 'Not found.';
    if (code === 'exists') return 'A file with that name already exists.';
    if (code === 'too_large') return 'Too large (the limit is 100 MB).';
    return e.detail;
  }
  return 'Could not reach the GFV server.';
}

export function FilesApp({ windowId }: { windowId: string }) {
  const serverId = useDesktop((s) => s.windows[windowId]?.serverId);
  const [path, setPath] = useState('~');
  const [pathInput, setPathInput] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [home, setHome] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const [note, setNote] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);
  const provide = useAppMenus(windowId);
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const load = useCallback(
    async (target: string) => {
      if (!serverId) return;
      const seq = ++loadSeq.current;
      setLoading(true);
      setError('');
      try {
        const r = await api.fsList(serverId, target);
        if (seq !== loadSeq.current) return; // a newer navigation won
        setEntries(r.entries);
        setHome(r.home);
        setPath(r.path);
        setPathInput(r.path);
        setSelected(null);
      } catch (e) {
        if (seq === loadSeq.current) setError(describe(e));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    void load('~');
  }, [load]);

  const visible = useMemo(() => {
    const list = entries.filter((e) => showHidden || !e.name.startsWith('.'));
    const isDir = (e: FileEntry) => e.type === 'dir' || e.targetIsDir;
    return list.sort((a, b) => {
      if (!!isDir(a) !== !!isDir(b)) return isDir(a) ? -1 : 1; // folders first
      const v = sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
      return v * sort.dir;
    });
  }, [entries, showHidden, sort]);

  if (!serverId) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
        Pick a server in the menu bar, then open a new Files window.
      </div>
    );
  }

  const sel = entries.find((e) => e.path === selected);
  const refresh = () => void load(path);
  const afterRun = () => void load(path);

  const open = (e: FileEntry) => {
    if (e.type === 'dir' || e.targetIsDir) void load(e.path);
    else if (e.type === 'file' || e.type === 'symlink') openEditor(serverId, e.path);
  };

  const askName = (spec: Omit<PromptSpec, 'validate' | 'label'> & { label?: string }) =>
    setPrompt({ label: 'Name', validate: nameError, ...spec });

  const newFolder = () =>
    askName({
      title: 'New folder',
      submitLabel: 'Create',
      onSubmit: (name) =>
        requestRun({
          serverId,
          actionId: 'files.mkdir',
          params: { path: joinPath(path, name) },
          onDone: afterRun,
        }),
    });

  const rename = (e: FileEntry) =>
    askName({
      title: `Rename ${e.name}`,
      label: 'New name',
      initial: e.name,
      submitLabel: 'Rename',
      onSubmit: (name) =>
        requestRun({
          serverId,
          actionId: 'files.rename',
          params: { from: e.path, to: joinPath(path, name) },
          onDone: afterRun,
        }),
    });

  const chmod = (e: FileEntry) =>
    setPrompt({
      title: `Permissions for ${e.name}`,
      description: 'Three digits: owner, group, everyone else. 4 = read, 2 = write, 1 = run.',
      label: 'Mode',
      initial: e.mode,
      submitLabel: 'Review…',
      checkbox: e.type === 'dir' ? 'Apply to everything inside too' : undefined,
      validate: (v) => (/^[0-7]{3,4}$/.test(v) ? null : 'Use 3 or 4 digits from 0 to 7, like 644.'),
      onSubmit: (mode, recursive) =>
        requestRun({
          serverId,
          actionId: 'files.chmod',
          params: { path: e.path, mode, recursive },
          onDone: afterRun,
        }),
    });

  const remove = (e: FileEntry) =>
    requestRun({
      serverId,
      actionId: 'files.delete-path',
      params: { path: e.path },
      onDone: afterRun,
    });

  const upload = async (files: File[]) => {
    const names = new Set(entries.map((e) => e.name));
    const problems: string[] = [];
    let done = 0;
    for (const f of files) {
      setNote(`Uploading ${f.name} (${done + 1}/${files.length})…`);
      if (names.has(f.name)) {
        problems.push(`${f.name}: already exists here, rename or delete it first`);
        continue;
      }
      try {
        await api.fsUpload(serverId, joinPath(path, f.name), f);
        done++;
      } catch (e) {
        problems.push(`${f.name}: ${describe(e)}`);
      }
    }
    setNote(
      [done ? `Uploaded ${done} file${done === 1 ? '' : 's'}.` : '', ...problems]
        .filter(Boolean)
        .join(' '),
    );
    refresh();
  };

  const download = (e: FileEntry) => {
    const a = document.createElement('a');
    a.href = api.fsDownloadUrl(serverId, e.path);
    a.download = e.name;
    a.click();
  };

  // The same items drive the File menu (for the selected row) and the right-click menus.
  const entryItems = (e: FileEntry | undefined): MenuItem[] => [
    { label: 'Open', disabled: !e, onSelect: () => e && open(e) },
    { label: 'Rename…', disabled: !e, onSelect: () => e && rename(e) },
    { label: 'Permissions…', disabled: !e, onSelect: () => e && chmod(e) },
    { label: 'Download', disabled: !e || e.type === 'dir', onSelect: () => e && download(e) },
    { type: 'separator' },
    { label: 'Delete…', danger: true, disabled: !e, onSelect: () => e && remove(e) },
  ];
  const folderItems = (): MenuItem[] => [
    { label: 'New Folder…', onSelect: newFolder },
    { label: 'Upload…', onSelect: () => fileInput.current?.click() },
  ];
  provide(() => ({
    file: [
      ...folderItems(),
      { type: 'separator' },
      ...entryItems(sel),
      { type: 'separator' },
      { label: 'Refresh', onSelect: refresh },
    ],
    view: [
      { label: 'Show Hidden Files', checked: showHidden, onSelect: () => setShowHidden((h) => !h) },
      { type: 'separator' },
      { label: 'Go to Parent Folder', onSelect: () => void load(parentPath(path)) },
      { label: 'Go to Home Folder', onSelect: () => void load(home || '~') },
    ],
  }));

  /** A file dragged in from another Files window (any server): copy it into `dir`. */
  const copyHere = async (raw: string, dir: string) => {
    const parsed = TransferPayloadSchema.safeParse(safeJson(raw));
    if (!parsed.success) return;
    const f = parsed.data;
    if (f.type === 'dir')
      return toast({
        kind: 'error',
        title: 'Folders cannot be copied yet',
        body: 'Drag files, or copy a folder with the Terminal (scp, rsync).',
      });
    const dest = joinPath(dir, f.name);
    const label = `${f.name} → ${dir}`;
    setNote(`Copying ${label}…`);
    try {
      await api.transfer({ serverId: f.serverId, path: f.path }, { serverId, path: dest });
      toast({ kind: 'success', title: `Copied ${f.name}`, body: `to ${dir}` });
      setNote('');
      refresh();
    } catch (e) {
      setNote('');
      toast({ kind: 'error', title: `Could not copy ${f.name}`, body: describe(e) });
    }
  };

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const arrow = (key: SortKey) =>
    sort.key === key ? (
      sort.dir === 1 ? (
        <ChevronUp size={12} className="ml-0.5 inline" />
      ) : (
        <ChevronDown size={12} className="ml-0.5 inline" />
      )
    ) : null;
  const tb = 'h-7 px-2 text-xs';

  return (
    <div
      data-path={path}
      className={cn('relative flex h-full flex-col text-sm', dragging && 'bg-primary/10')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TRANSFER_MIME)) {
          e.preventDefault();
          setDragging(true);
        } else if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dragged = e.dataTransfer.getData(TRANSFER_MIME);
        if (dragged) return void copyHere(dragged, path);
        void upload([...e.dataTransfer.files].filter((f) => f.size > 0 || f.type !== ''));
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
        <Button
          variant="ghost"
          className={tb}
          aria-label="Up"
          onClick={() => void load(parentPath(path))}
        >
          <ArrowUp size={14} />
        </Button>
        <Button
          variant="ghost"
          className={tb}
          aria-label="Home"
          onClick={() => void load(home || '~')}
        >
          <House size={14} />
        </Button>
        <Button variant="ghost" className={tb} aria-label="Refresh" onClick={refresh}>
          <RefreshCw size={13} />
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            void load(pathInput.trim() || '/');
          }}
        >
          <Input
            aria-label="Path"
            className="h-7 text-xs"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
          />
        </form>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-1.5">
        <Button variant="outline" className={tb} onClick={newFolder}>
          New folder
        </Button>
        <Button variant="outline" className={tb} onClick={() => fileInput.current?.click()}>
          Upload
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="upload-input"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <Button variant="outline" className={tb} disabled={!sel} onClick={() => sel && rename(sel)}>
          Rename
        </Button>
        <Button variant="outline" className={tb} disabled={!sel} onClick={() => sel && chmod(sel)}>
          Permissions
        </Button>
        <Button
          variant="outline"
          className={tb}
          disabled={!sel || sel.type === 'dir'}
          onClick={() => sel && download(sel)}
        >
          Download
        </Button>
        <Button
          variant="destructive"
          className={tb}
          disabled={!sel}
          onClick={() => sel && remove(sel)}
        >
          Delete
        </Button>
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Hidden files
        </label>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        onContextMenu={(ev) => {
          // Right-click on a row = that file's menu; on empty space = the folder's menu.
          ev.preventDefault();
          const row = (ev.target as Element).closest<HTMLElement>('[data-path-entry]');
          const entry = row ? entries.find((x) => x.path === row.dataset.pathEntry) : undefined;
          if (entry) setSelected(entry.path);
          setCtx({
            x: ev.clientX,
            y: ev.clientY,
            items: entry
              ? entryItems(entry)
              : [...folderItems(), { type: 'separator' }, { label: 'Refresh', onSelect: refresh }],
          });
        }}
      >
        {error ? (
          <div className="grid h-full place-items-center p-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <p role="alert" className="text-danger">
                {error}
              </p>
              <Button size="sm" onClick={refresh}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <table className="w-full table-fixed text-xs">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="cursor-pointer px-2 py-1" onClick={() => sortBy('name')}>
                  Name{arrow('name')}
                </th>
                <th
                  className="w-20 cursor-pointer px-2 py-1 text-right"
                  onClick={() => sortBy('size')}
                >
                  Size{arrow('size')}
                </th>
                <th className="w-36 cursor-pointer px-2 py-1" onClick={() => sortBy('mtime')}>
                  Modified{arrow('mtime')}
                </th>
                <th className="w-14 px-2 py-1">Mode</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr
                  key={e.path}
                  data-testid="file-row"
                  data-path-entry={e.path}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.effectAllowed = 'copy';
                    ev.dataTransfer.setData(
                      TRANSFER_MIME,
                      JSON.stringify({ serverId, path: e.path, name: e.name, type: e.type }),
                    );
                  }}
                  onDragOver={(ev) => {
                    // Dropping a file ON a folder row copies it into that folder.
                    if (
                      (e.type === 'dir' || e.targetIsDir) &&
                      ev.dataTransfer.types.includes(TRANSFER_MIME)
                    )
                      ev.preventDefault();
                  }}
                  onDrop={(ev) => {
                    const dragged = ev.dataTransfer.getData(TRANSFER_MIME);
                    if (!dragged || !(e.type === 'dir' || e.targetIsDir)) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    setDragging(false);
                    void copyHere(dragged, e.path);
                  }}
                  className={cn(
                    'cursor-default select-none hover:bg-accent',
                    selected === e.path && 'bg-primary/15',
                  )}
                  onClick={() => setSelected(e.path)}
                  onDoubleClick={() => open(e)}
                >
                  <td className="truncate px-2 py-1">
                    <EntryIcon type={e.type} />
                    {e.name}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {e.type === 'dir' ? '' : formatSize(e.size)}
                  </td>
                  <td className="px-2 py-1 tabular-nums">{new Date(e.mtime).toLocaleString()}</td>
                  <td className="px-2 py-1 font-mono">{e.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!error && !loading && visible.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            This folder is empty. Drag files here to upload them.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-2 py-1 text-xs text-muted-foreground">
        {loading ? 'Loading…' : note || `${visible.length} items`}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center border-2 border-dashed border-primary text-sm font-medium">
          Drop to copy to {path}
        </div>
      )}
      {prompt && <PromptDialog spec={prompt} onClose={() => setPrompt(null)} />}
      {ctx && (
        <Menu
          label="File actions"
          items={ctx.items}
          x={ctx.x}
          y={ctx.y}
          minWidth={190}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}
