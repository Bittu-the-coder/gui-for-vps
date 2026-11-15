import {
  classifySql,
  quoteIdent,
  toCsv,
  type DbColumn,
  type DbTable,
  type PublicConnection,
  type QueryResult,
} from '@gfv/shared';
import { Database, Download, Play, Plus, Table2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../../components/confirmStore';
import { NoServer } from '../../components/NoServer';
import { Button } from '../../components/ui/button';
import { useDesktop } from '../../desktop/windowStore';
import { ApiError, api } from '../../lib/api';
import { ConnectionDialog } from './ConnectionDialog';

const errText = (e: unknown) =>
  e instanceof ApiError ? e.detail : e instanceof Error ? e.message : 'Something went wrong.';

/** Browse and query a PostgreSQL database that lives on the server, through an SSH tunnel. Read-only unless you say otherwise. */
export function DatabaseApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const serverId = win?.serverId;
  const [conns, setConns] = useState<PublicConnection[]>([]);
  const [connId, setConnId] = useState('');
  const [tables, setTables] = useState<DbTable[]>([]);
  const [selected, setSelected] = useState<DbTable | null>(null);
  const [columns, setColumns] = useState<DbColumn[]>([]);
  const [sql, setSql] = useState('select version();');
  const [allowWrite, setAllowWrite] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  const loadConns = async () => {
    if (!serverId) return;
    const list = await api.dbList(serverId);
    setConns(list);
    setConnId((cur) => (list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? '')));
  };
  useEffect(() => {
    void loadConns().catch((e) => setError(errText(e)));
  }, [serverId]);

  const loadTables = async (id: string) => {
    setError('');
    setTables([]);
    setSelected(null);
    setResult(null);
    try {
      setTables(await api.dbTables(id));
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    if (connId) void loadTables(connId);
  }, [connId]);

  if (!serverId) return <NoServer app="Database" />;

  const run = async (text: string, write: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (write) {
        const ok = await confirmDialog({
          title: 'Run this and change the database?',
          body: 'The statement will be committed. There is no automatic undo: back up first if the data matters.',
          confirmLabel: 'Run and commit',
        });
        if (!ok) return;
      }
      setResult(await api.dbQuery(connId, text, write, write));
      if (write)
        void api
          .dbTables(connId)
          .then(setTables)
          .catch(() => {}); // refresh the list, keep the result on screen
    } catch (e) {
      setResult(null);
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const open = async (t: DbTable) => {
    setSelected(t);
    setError('');
    setBusy(true);
    try {
      const [cols, prev] = await Promise.all([
        api.dbColumns(connId, t.schema, t.name),
        api.dbPreview(connId, t.schema, t.name),
      ]);
      setColumns(cols);
      setResult(prev);
      setSql(`select * from ${quoteIdent(t.schema)}.${quoteIdent(t.name)} limit 100;`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!result) return;
    const blob = new Blob([toCsv(result.columns, result.rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${selected?.name ?? 'query'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const kind = classifySql(sql);

  return (
    <div className="flex h-full text-body">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sunken max-md:w-40">
        <div className="flex items-center gap-1 border-b border-border p-2">
          <select
            aria-label="Connection"
            className="h-8 min-w-0 flex-1 rounded-control border border-border bg-background px-1 text-footnote"
            value={connId}
            onChange={(e) => setConnId(e.target.value)}
          >
            {conns.length === 0 && <option value="">No connection</option>}
            {conns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            aria-label="Add connection"
            onClick={() => setAdding(true)}
          >
            <Plus size={13} />
          </Button>
          {connId && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              aria-label="Delete connection"
              onClick={() =>
                void confirmDialog({
                  title: 'Delete this connection?',
                  body: 'Only the saved login is deleted, not the database.',
                  confirmLabel: 'Delete',
                }).then((ok) => {
                  if (ok) void api.dbRemove(connId).then(loadConns);
                })
              }
            >
              <Trash2 size={13} />
            </Button>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {tables.map((t) => (
            <li key={`${t.schema}.${t.name}`}>
              <button
                data-testid="db-table"
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-footnote hover:bg-accent ${selected?.name === t.name && selected.schema === t.schema ? 'bg-primary/15' : ''}`}
                onClick={() => void open(t)}
              >
                <Table2 size={12} className="shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {t.schema !== 'public' && (
                    <span className="text-muted-foreground">{t.schema}.</span>
                  )}
                  {t.name}
                </span>
                {t.kind === 'view' && (
                  <span className="ml-auto text-caption text-muted-foreground">view</span>
                )}
              </button>
            </li>
          ))}
          {connId && tables.length === 0 && !error && (
            <li className="p-2 text-footnote text-muted-foreground">No tables yet.</li>
          )}
        </ul>
        {selected && columns.length > 0 && (
          <div className="max-h-40 overflow-auto border-t border-border p-2 text-caption">
            <p className="mb-1 font-semibold uppercase tracking-wide text-faint-foreground">
              Columns
            </p>
            {columns.map((c) => (
              <p key={c.name} className="truncate">
                <span className="font-mono">{c.name}</span>{' '}
                <span className="text-muted-foreground">
                  {c.type}
                  {c.nullable ? '' : ' not null'}
                </span>
              </p>
            ))}
          </div>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {conns.length === 0 ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm">
              <Database size={28} className="mx-auto mb-2 text-link" />
              <p className="font-medium">Connect to a PostgreSQL database</p>
              <p className="mt-1 text-footnote text-muted-foreground">
                GFV reaches it through the SSH connection to this server, so the database never
                needs to be open to the internet. Started one with the App Store? Use host 127.0.0.1
                and the port you chose.
              </p>
              <Button className="mt-3" onClick={() => setAdding(true)}>
                New connection
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-col gap-1 border-b border-border p-2">
              <textarea
                ref={editor}
                aria-label="SQL"
                spellCheck={false}
                rows={4}
                className="w-full resize-y rounded-control border border-border bg-background p-2 font-mono text-footnote focus-visible:outline-offset-1"
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void run(sql, allowWrite);
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy || !sql.trim()}
                  onClick={() => void run(sql, allowWrite)}
                >
                  <Play size={12} /> Run (Ctrl+Enter)
                </Button>
                <label className="flex items-center gap-1 text-footnote">
                  <input
                    type="checkbox"
                    checked={allowWrite}
                    onChange={(e) => setAllowWrite(e.target.checked)}
                  />{' '}
                  Allow changes
                </label>
                {kind === 'write' && !allowWrite && (
                  <span data-testid="write-hint" className="text-footnote text-warning">
                    This looks like it changes data: it will be refused unless “Allow changes” is
                    on.
                  </span>
                )}
                {result && result.columns.length > 0 && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={exportCsv}>
                    <Download size={12} /> Export CSV
                  </Button>
                )}
              </div>
            </div>
            {error && (
              <p role="alert" data-testid="db-error" className="p-2 text-footnote text-danger">
                {error}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {result && result.columns.length === 0 && (
                <p data-testid="db-command" className="p-3 text-footnote">
                  {result.command}
                  {result.rowCount !== null
                    ? ` · ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`
                    : ''}{' '}
                  · {result.ms} ms
                </p>
              )}
              {result && result.columns.length > 0 && (
                <>
                  <table className="min-w-full border-collapse text-footnote" data-testid="db-grid">
                    <thead className="sticky top-0 bg-sunken text-left">
                      <tr>
                        {result.columns.map((c, i) => (
                          <th
                            key={`${c}${i}`}
                            className="whitespace-nowrap border-b border-border px-2 py-1 font-semibold"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-accent">
                          {r.map((v, j) => (
                            <td
                              key={j}
                              className="max-w-72 truncate whitespace-nowrap px-2 py-1 font-mono"
                              title={v ?? 'NULL'}
                            >
                              {v === null ? <span className="text-muted-foreground">NULL</span> : v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="p-2 text-caption text-muted-foreground">
                    {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
                    {result.truncated ? ' shown (more exist: add a LIMIT or a WHERE)' : ''} ·{' '}
                    {result.ms} ms
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </section>
      {adding && (
        <ConnectionDialog
          serverId={serverId}
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            void loadConns().then(() => setConnId(c.id));
          }}
        />
      )}
    </div>
  );
}
