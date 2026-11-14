import type { ActionInfo, Plan, RecipeDetail } from '@gfv/shared';
import { useEffect, useMemo, useState } from 'react';
import { RiskBadge } from '../../components/RiskBadge';
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
import { ApiError, api } from '../../lib/api';
import { useJobs } from '../../stores/jobStore';
import { useServers } from '../../stores/serverStore';
import { appById } from '../registry';

export type PlanSource = { kind: 'replay'; recipe: RecipeDetail } | { kind: 'broadcast' };

/**
 * Choose servers (and parameter values / an action), see EXACTLY what would run on each server, confirm
 * once if anything is risky, then start. Nothing runs before the final button, and the server re-checks
 * the confirmation, so this dialog cannot skip the Safety Net.
 */
export function PlanDialog({ source, onClose }: { source: PlanSource; onClose: () => void }) {
  const servers = useServers((s) => s.servers);
  const statuses = useServers((s) => s.statuses);
  const watch = useJobs((s) => s.watch);
  const recipe = source.kind === 'replay' ? source.recipe : null;

  const connected = (id: string) => statuses[id] === 'connected';
  const [picked, setPicked] = useState<string[]>(() =>
    servers.filter((s) => connected(s.id) && s.id !== recipe?.serverId).map((s) => s.id),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [actionId, setActionId] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    if (source.kind !== 'broadcast') return;
    api
      .actions()
      .then((a) => {
        setActions(a);
        setActionId((cur) => cur || a[0]?.id || '');
      })
      .catch(() => {});
  }, [source.kind]);

  const action = actions.find((a) => a.id === actionId);
  const body = useMemo(
    () =>
      source.kind === 'replay'
        ? { kind: 'replay' as const, serverIds: picked, recipeId: source.recipe.id, values }
        : {
            kind: 'broadcast' as const,
            serverIds: picked,
            steps: [
              {
                actionId,
                params: Object.fromEntries(
                  (action?.fields ?? []).map((f) => [f.name, fieldValues[f.name] ?? '']),
                ),
              },
            ],
          },
    [source, picked, values, actionId, action, fieldValues],
  );

  // Any change invalidates the plan: you always confirm what is on screen.
  useEffect(() => {
    setPlan(null);
    setUnderstood(false);
    setError('');
  }, [body]);

  const describe = (e: unknown): string => {
    if (e instanceof ApiError) {
      const b = e.body as {
        error?: string;
        problems?: string[];
        missing?: string[];
        serverIds?: string[];
      };
      if (b.error === 'not_connected')
        return `Not connected: ${(b.serverIds ?? []).map((id) => servers.find((s) => s.id === id)?.name ?? id).join(', ')}.`;
      if (b.error === 'invalid_steps') return (b.problems ?? []).join(' ');
      if (b.error === 'missing_params') return `Fill in: ${(b.missing ?? []).join(', ')}.`;
      return e.detail;
    }
    return 'Could not reach the GFV server.';
  };

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await api.jobPlan(body);
      setPlan(p);
      if (p.missing.length)
        setError(
          `Fill in: ${p.missing.map((n) => recipe?.params.find((x) => x.name === n)?.label ?? n).join(', ')}.`,
        );
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const job = await api.createJob({ ...body, confirmed: understood });
      watch(job.id, () => openApp(appById('jobs')!));
      useJobs.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
      openApp(appById('jobs')!);
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const problems = plan?.targets.flatMap((t) => t.steps.filter((s) => !s.ok)).length ?? 0;
  const needsConfirm = !!plan && plan.risk !== 'safe';
  const canStart =
    !!plan &&
    !plan.missing.length &&
    !problems &&
    picked.length > 0 &&
    (!needsConfirm || understood);
  const name = (id: string) => servers.find((s) => s.id === id)?.name ?? id;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {recipe ? `Run “${recipe.name}” on…` : 'Run an action on several servers'}
          </DialogTitle>
          <DialogDescription>
            Each server runs the steps in order, all servers at the same time. If a step fails, that
            server pauses and asks you what to do; the others keep going.
          </DialogDescription>
        </DialogHeader>

        {source.kind === 'broadcast' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="bc-action">Action</Label>
            <select
              id="bc-action"
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
              className="w-full"
            >
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} ({a.risk})
                </option>
              ))}
            </select>
            {action && <p className="text-footnote text-muted-foreground">{action.explain}</p>}
            {(action?.fields ?? []).map((f) => (
              <label key={f.name} className="flex flex-col gap-1 text-footnote">
                {f.label}
                <Input
                  placeholder={f.placeholder}
                  value={fieldValues[f.name] ?? ''}
                  onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-body font-medium">Servers</legend>
          {servers.length === 0 && (
            <p className="text-footnote text-muted-foreground">Add a server first.</p>
          )}
          {servers.map((s) => (
            <label
              key={s.id}
              className={`flex items-center gap-2 text-body ${connected(s.id) ? '' : 'opacity-50'}`}
            >
              <input
                type="checkbox"
                disabled={!connected(s.id)}
                checked={picked.includes(s.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))
                }
              />
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
              {!connected(s.id) && (
                <span className="text-footnote text-muted-foreground">(not connected)</span>
              )}
              {s.id === recipe?.serverId && (
                <span className="text-footnote text-muted-foreground">(recorded here)</span>
              )}
            </label>
          ))}
        </fieldset>

        {recipe && recipe.params.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-body font-medium">Parameters</legend>
            {recipe.params.map((p) => (
              <label key={p.name} className="flex flex-col gap-1 text-footnote">
                {p.label}
                {p.default !== undefined && !p.secret
                  ? ` (default: ${p.default})`
                  : p.secret
                    ? ' (secret: never stored)'
                    : ' (required)'}
                <Input
                  type={p.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[p.name] ?? ''}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                />
              </label>
            ))}
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}

        {plan && !plan.missing.length && (
          <div
            className="flex max-h-72 flex-col gap-2 overflow-auto rounded-xl border border-separator p-2"
            aria-label="Plan"
          >
            <p className="flex items-center gap-2 text-footnote text-muted-foreground">
              What will run <RiskBadge risk={plan.risk} />
            </p>
            {plan.targets.map((t) => (
              <details key={t.serverId} open={plan.targets.length === 1}>
                <summary className="cursor-pointer text-body font-medium">
                  {name(t.serverId)} · {t.steps.length} step{t.steps.length === 1 ? '' : 's'}
                  {!t.connected && <span className="ml-2 text-danger">not connected</span>}
                </summary>
                <ol className="mt-1 flex flex-col gap-1.5 pl-1">
                  {t.steps.map((s, i) =>
                    s.ok ? (
                      <li key={i}>
                        <p className="flex items-center gap-1.5 text-footnote font-medium">
                          {i + 1}. {s.preview.title} <RiskBadge risk={s.preview.risk} />
                        </p>
                        {s.preview.commands.map((c, k) => (
                          <code
                            key={k}
                            className="mt-0.5 block whitespace-pre-wrap break-all rounded-md bg-code px-2 py-1 text-caption text-code-foreground"
                          >
                            $ {c}
                          </code>
                        ))}
                      </li>
                    ) : (
                      <li key={i} className="text-footnote text-danger">
                        {i + 1}. {s.actionId}: {s.error}
                      </li>
                    ),
                  )}
                </ol>
              </details>
            ))}
            {needsConfirm && (
              <label className="flex items-center gap-2 rounded-lg border border-warning bg-warning/10 p-2 text-body">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                />
                I understand the risk on every server listed above
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || picked.length === 0 || (source.kind === 'broadcast' && !actionId)}
            onClick={() => void preview()}
          >
            {plan ? 'Refresh preview' : 'Preview'}
          </Button>
          <Button disabled={busy || !canStart} onClick={() => void start()}>
            {plan?.risk === 'danger' ? 'Run anyway' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
