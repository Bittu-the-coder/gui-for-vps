import { useEffect, useRef, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { queryProblem } from './NoServer';
import { Button } from './ui/button';

/** Recent log lines for one service/container. Refreshes on demand or every 2 s while Follow is on (re-reads the latest lines, not a live stream). */
export function LogPanel({
  serverId,
  actionId,
  params,
  title,
  tool,
  active,
  onClose,
}: {
  serverId: string;
  actionId: 'services.logs' | 'docker.logs';
  params: object;
  title: string;
  tool: string;
  active: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(false);
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLPreElement>(null);

  const fetchLogs = async () => {
    const r = await api.query(serverId, actionId, params);
    const problem = queryProblem(r.exitCode, r.stderr, tool);
    setError(problem ?? '');
    if (!problem) setText(r.stdout || r.stderr);
  };

  // Always load once when the selection changes (or Refresh is pressed); poll only if auto is on.
  usePolling(fetchLogs, 2000, active && auto);
  useEffect(() => {
    void fetchLogs().catch(() => setError('Could not read the logs.'));
  }, [serverId, actionId, JSON.stringify(params), tick]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [text]);

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border">
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        <strong className="min-w-0 flex-1 truncate">Logs: {title}</strong>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Follow (every 2 s)
        </label>
        <Button
          variant="outline"
          className="h-6 px-2 text-xs"
          onClick={() => setTick((t) => t + 1)}
        >
          Refresh
        </Button>
        <Button
          variant="ghost"
          className="h-6 px-2 text-xs"
          aria-label="Close logs"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <pre
          ref={box}
          data-testid="log-output"
          className="min-h-0 flex-1 overflow-auto bg-slate-950 p-2 font-mono text-[11px] text-slate-200"
        >
          {text || 'No log lines.'}
        </pre>
      )}
    </div>
  );
}
