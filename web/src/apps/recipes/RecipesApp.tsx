import { recipeStepInfo, type Recipe, type RecipeDetail } from '@gfv/shared';
import { useCallback, useEffect, useState } from 'react';
import { RiskBadge } from '../../components/RiskBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useRecording } from '../../stores/recordingStore';
import { useServers } from '../../stores/serverStore';

/** Recorded sequences of actions: edit the steps and export them as a bash script. */
export function RecipesApp() {
  const recording = useRecording((s) => s.active);
  const justStopped = useRecording((s) => s.justStopped);
  const clearJustStopped = useRecording((s) => s.clearJustStopped);
  const servers = useServers((s) => s.servers);
  const [list, setList] = useState<Recipe[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [tab, setTab] = useState<'steps' | 'script'>('steps');
  const [script, setScript] = useState<{ script: string; filename: string } | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const loadList = useCallback(async () => {
    try {
      setList(await api.recipes());
    } catch {
      /* keep the old list */
    }
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api.recipe(id);
      setDetail(d);
      setName(d.name);
      setScript(null);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => void loadList(), [loadList, recording?.stepCount, recording?.recipeId]);
  // A just-finished (or in-progress) recording opens by itself.
  useEffect(() => {
    if (recording?.recipeId) setSelectedId(recording.recipeId);
  }, [recording?.recipeId]);
  useEffect(() => {
    if (!justStopped) return;
    setSelectedId(justStopped);
    setTab('steps');
    void loadList();
    clearJustStopped();
  }, [justStopped, clearJustStopped, loadList]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail, recording?.stepCount]);
  useEffect(() => {
    if (tab === 'script' && selectedId) {
      api
        .exportRecipe(selectedId)
        .then(setScript)
        .catch(() => setScript(null));
    }
  }, [tab, selectedId, detail]);

  const mutate = async (fn: () => Promise<unknown>) => {
    if (!selectedId) return;
    try {
      await fn();
    } catch {
      setNote('That did not work. Try again.');
    }
    await Promise.all([loadDetail(selectedId), loadList()]);
  };

  const move = (i: number, d: -1 | 1) => {
    if (!detail) return;
    const order = detail.steps.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    void mutate(() => api.reorderSteps(detail.id, order));
  };

  const download = () => {
    if (!script) return;
    const url = URL.createObjectURL(new Blob([script.script], { type: 'text/x-shellscript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = script.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isRecording = detail && recording?.recipeId === detail.id;
  const serverName = (id: string | null) =>
    servers.find((s) => s.id === id)?.name ?? 'a deleted server';

  return (
    <div className="flex h-full text-sm">
      <div className="w-56 shrink-0 overflow-auto border-r border-border">
        {list.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            No recipes yet. Press ⏺ Record in the menu bar, do things in GFV, then press ■ Stop.
          </p>
        )}
        {list.map((r) => (
          <button
            key={r.id}
            data-testid="recipe-row"
            className={cn(
              'block w-full border-b border-border/50 px-3 py-2 text-left hover:bg-accent',
              selectedId === r.id && 'bg-sky-500/25',
            )}
            onClick={() => {
              setSelectedId(r.id);
              setTab('steps');
            }}
          >
            <div className="truncate font-medium">{r.name}</div>
            <div className="text-xs text-muted-foreground">
              {r.stepCount} step{r.stepCount === 1 ? '' : 's'} · {serverName(r.serverId)}
              {recording?.recipeId === r.id && <span className="text-red-500"> · recording</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!detail ? (
          <div className="grid flex-1 place-items-center p-4 text-center text-muted-foreground">
            Pick a recipe.
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
              <Input
                aria-label="Recipe name"
                className="h-8 flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() =>
                  name.trim() &&
                  name !== detail.name &&
                  void mutate(() => api.renameRecipe(detail.id, name.trim()))
                }
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <Button
                size="sm"
                variant={tab === 'steps' ? 'default' : 'outline'}
                onClick={() => setTab('steps')}
              >
                Steps
              </Button>
              <Button
                size="sm"
                variant={tab === 'script' ? 'default' : 'outline'}
                onClick={() => setTab('script')}
              >
                Script
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500"
                disabled={!!isRecording}
                title={isRecording ? 'Stop recording first' : undefined}
                onClick={() => {
                  if (!window.confirm(`Delete the recipe "${detail.name}"?`)) return;
                  void api.deleteRecipe(detail.id).then(() => {
                    setSelectedId(null);
                    return loadList();
                  });
                }}
              >
                Delete
              </Button>
            </div>
            {isRecording && (
              <p className="bg-red-500/15 px-2 py-1 text-xs text-red-600 dark:text-red-300">
                ⏺ Recording on {serverName(detail.serverId)}: every successful action you run there
                is added as a step.
              </p>
            )}
            {note && (
              <p role="alert" className="px-2 py-1 text-xs text-red-600">
                {note}
              </p>
            )}

            {tab === 'steps' ? (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {detail.steps.length === 0 && (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    No steps yet. Run actions (create folders, install tools, restart services…)
                    while recording.
                  </p>
                )}
                <ol className="flex flex-col gap-2">
                  {detail.steps.map((s, i) => {
                    const info = recipeStepInfo(s.actionId, s.params);
                    return (
                      <li
                        key={s.id}
                        data-testid="recipe-step"
                        className="rounded border border-border p-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{i + 1}.</span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {info?.title ?? s.actionId}
                          </span>
                          {info && <RiskBadge risk={info.risk} />}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5"
                            aria-label="Move up"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5"
                            aria-label="Move down"
                            disabled={i === detail.steps.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-red-500"
                            aria-label="Delete step"
                            onClick={() => void mutate(() => api.deleteStep(detail.id, s.id))}
                          >
                            ✕
                          </Button>
                        </div>
                        {info ? (
                          <>
                            <p className="my-1 text-xs text-muted-foreground">{info.explain}</p>
                            {info.commands.map((c, k) => (
                              <code
                                key={k}
                                className="mt-1 block whitespace-pre-wrap break-all rounded bg-slate-900 px-2 py-1 text-xs text-slate-100"
                              >
                                $ {c}
                              </code>
                            ))}
                          </>
                        ) : (
                          <p className="text-xs text-red-500">
                            This action is not available in this version of GFV. It will be skipped
                            in the script.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  Only actions are recorded. File edits, uploads and killed processes are not, so a
                  recipe rebuilds the setup, not your file contents.
                </p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 gap-2 border-b border-border p-2">
                  <Button
                    size="sm"
                    disabled={!script}
                    onClick={() => script && void navigator.clipboard?.writeText(script.script)}
                  >
                    Copy
                  </Button>
                  <Button size="sm" variant="outline" disabled={!script} onClick={download}>
                    Download {script?.filename}
                  </Button>
                  <span className="self-center text-xs text-muted-foreground">
                    Run it on a server with: bash {script?.filename}
                  </span>
                </div>
                <pre
                  data-testid="script-view"
                  className="min-h-0 flex-1 overflow-auto bg-slate-950 p-3 font-mono text-xs text-slate-100"
                >
                  {script?.script ?? 'Generating…'}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
