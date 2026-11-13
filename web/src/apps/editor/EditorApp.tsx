import { detectDanger, isCriticalConfigPath } from '@gfv/shared';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { registerCloseGuard, useDesktop } from '../../desktop/windowStore';
import { api, ApiError } from '../../lib/api';
import { requestRun } from '../../runner/runStore';

// Monaco is big: it only downloads when the first editor window opens.
const MonacoEditor = lazy(() => import('./MonacoEditor'));

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'ready' };

function saveError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.body as { error?: string; message?: string })?.error;
    if (code === 'permission_denied')
      return 'Permission denied. GFV saves as your SSH user, which cannot write this file (files in /etc usually need root).';
    if (code === 'not_connected') return 'This server is not connected.';
    if (code === 'too_large') return 'This file is too large to save from the editor (5 MB limit).';
    return (e.body as { message?: string })?.message ?? e.detail;
  }
  return 'Could not reach the GFV server.';
}

export function EditorApp({ windowId }: { windowId: string }) {
  const win = useDesktop((s) => s.windows[windowId]);
  const theme = useDesktop((s) => s.theme);
  const setTitle = useDesktop((s) => s.setTitle);
  const serverId = win?.serverId;
  const path = win?.arg;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [initial, setInitial] = useState('');
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // The normal save was refused (permission denied): offer to save with sudo instead.
  const [sudoOffer, setSudoOffer] = useState(false);
  const latest = useRef({ value: '', saved: '' });
  latest.current = { value, saved };
  const dirty = value !== saved;

  useEffect(() => {
    if (!serverId || !path) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .fsRead(serverId, path)
      .then((r) => {
        if (cancelled) return;
        if (r.kind === 'unsupported') {
          setLoad({
            kind: 'unsupported',
            message:
              r.reason === 'too_large'
                ? 'This file is larger than 5 MB, so it cannot be edited here. Download it from the File Manager instead.'
                : 'This looks like a binary file (or not UTF-8 text), so it is not safe to edit as text. Download it from the File Manager instead.',
          });
          return;
        }
        setInitial(r.content);
        setValue(r.content);
        setSaved(r.content);
        setLoad({ kind: 'ready' });
      })
      .catch((e) => {
        if (cancelled) return;
        const code = e instanceof ApiError ? (e.body as { error?: string })?.error : undefined;
        setLoad({
          kind: 'error',
          message:
            code === 'not_found'
              ? 'This file no longer exists.'
              : code === 'permission_denied'
                ? 'Permission denied: your SSH user cannot read this file.'
                : e instanceof ApiError
                  ? e.detail
                  : 'Could not reach the GFV server.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, path]);

  // Title shows a dot while there are unsaved changes; closing asks before discarding them.
  useEffect(() => {
    if (!path) return;
    setTitle(windowId, `${dirty ? '● ' : ''}${path.split('/').pop() || path}`);
  }, [dirty, path, windowId, setTitle]);
  useEffect(
    () => registerCloseGuard(windowId, () => latest.current.value !== latest.current.saved),
    [windowId],
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!serverId || !path) return;
    const { value: text, saved: was } = latest.current;
    if (text === was) return;
    if (isCriticalConfigPath(path)) {
      const why = detectDanger(`nano ${path}`)[0];
      const ok = window.confirm(
        `${why?.reason ?? 'A mistake in this file can lock you out.'}\n\n${why?.safer ?? ''}\n\nSave anyway?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    setStatus(null);
    setSudoOffer(false);
    try {
      const r = await api.fsSave(serverId, path, text);
      setSaved(text);
      setStatus({
        kind: 'ok',
        text: r.snapshotted
          ? 'Saved. The previous version was backed up on the server first.'
          : 'Saved.',
      });
    } catch (e) {
      setStatus({ kind: 'error', text: saveError(e) });
      if (e instanceof ApiError && (e.body as { error?: string })?.error === 'permission_denied') {
        setSudoOffer(true);
      }
    } finally {
      setSaving(false);
    }
  }, [serverId, path]);

  /**
   * Upload the text to a temp file, then let the Command Runner copy it over the real file with
   * sudo (backing the old version up first). You see the exact commands and confirm.
   */
  const saveWithSudo = async () => {
    if (!serverId || !path) return;
    const text = latest.current.value;
    const tmp = `/tmp/gfv-save-${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    try {
      await api.fsUpload(serverId, tmp, new File([text], 'save'));
    } catch {
      setStatus({
        kind: 'error',
        text: 'Could not upload the text to a temporary file on the server.',
      });
      return;
    }
    requestRun({
      serverId,
      actionId: 'files.write-root',
      params: { path, tmp },
      onDone: (code) => {
        if (code === 0) {
          setSaved(text);
          setSudoOffer(false);
          setStatus({
            kind: 'ok',
            text: 'Saved with sudo. The previous version was backed up first.',
          });
        } else
          setStatus({
            kind: 'error',
            text: 'Saving with sudo failed. Nothing was changed if the backup failed.',
          });
      },
    });
  };

  if (!serverId || !path) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
        Open a file from the Files app to edit it here.
      </div>
    );
  }
  if (load.kind === 'loading')
    return <div className="p-4 text-sm text-muted-foreground">Loading {path}…</div>;
  if (load.kind !== 'ready')
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm">
        <div>
          <p className="mb-1 font-mono text-xs text-muted-foreground">{path}</p>
          <p role="alert">{load.message}</p>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={path}>
          {path}
        </span>
        {status && (
          <span
            role="status"
            className={
              status.kind === 'ok'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }
          >
            {status.text}
          </span>
        )}
        {sudoOffer && (
          <Button size="sm" variant="outline" onClick={() => void saveWithSudo()}>
            Save with sudo…
          </Button>
        )}
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save (Ctrl+S)'}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={<div className="p-3 text-xs text-muted-foreground">Loading editor…</div>}
        >
          <MonacoEditor
            modelPath={`inmemory://${serverId}${path}`}
            value={initial}
            dark={theme === 'dark'}
            onChange={(v) => {
              setValue(v);
              setStatus(null);
            }}
            onSave={() => void save()}
          />
        </Suspense>
      </div>
    </div>
  );
}
