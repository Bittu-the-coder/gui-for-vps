import { confirmDialog } from '../../components/confirmStore';
import { BackBar } from '../../components/BackBar';
import { useCompact } from '../../desktop/compact';
import { ArrowDown, ArrowUp, Circle, Pencil, Play, X } from 'lucide-react';
import { EXPORT_FORMATS, type ExportFormat, type Recipe, type RecipeDetail } from '@gfv/shared';
import { useCallback, useEffect, useState } from 'react';
import { RiskBadge } from '../../components/RiskBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api, type RecipeExport } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useRecording } from '../../stores/recordingStore';
import { PlanDialog } from '../jobs/PlanDialog';
import { LibraryDialog } from './LibraryDialog';
import { ParamsEditor, StepParamsEditor } from './RecipeEditors';
import { describeStep } from './stepView';
import { useServers } from '../../stores/serverStore';

/** Recorded sequences of actions: edit the steps and export them as a bash script. */
export function RecipesApp() {
  const recording = useRecording((s) => s.active);
  const justStopped = useRecording((s) => s.justStopped);
  const clearJustStopped = useRecording((s) => s.clearJustStopped);
  const servers = useServers((s) => s.servers);
  const compact = useCompact();
  const [list, setList] = useState<Recipe[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [tab, setTab] = useState<'steps' | 'params' | 'script'>('steps');
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [runOn, setRunOn] = useState(false);
  const [library, setLibrary] = useState(false);
  const [script, setScript] = useState<RecipeExport | null>(null);
  const [format, setFormat] = useState<ExportFormat>('bash');
  const [fileIndex, setFileIndex] = useState(0);
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
        .exportRecipe(selectedId, format)
        .then((r) => {
          setScript(r);
          setFileIndex(0);
        })
        .catch(() => setScript(null));
    }
  }, [tab, selectedId, detail, format]);

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

  const file = script?.files[Math.min(fileIndex, (script?.files.length ?? 1) - 1)];
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const share = async () => {
    if (!detail) return;
    try {
      const f = await api.recipeFile(detail.id);
      const slug =
        detail.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe';
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.gfv-recipe.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNote('Could not create the file.');
    }
  };

  const isRecording = detail && recording?.recipeId === detail.id;
  const serverName = (id: string | null) =>
    servers.find((s) => s.id === id)?.name ?? 'a deleted server';

  return (
    <div className="flex h-full text-sm">
      <div
        className={
          compact
            ? `min-w-0 flex-1 overflow-auto ${selectedId ? 'hidden' : ''}`
            : 'w-56 shrink-0 overflow-auto border-r border-border'
        }
      >
        <div className="border-b border-border p-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => setLibrary(true)}>
            Library…
          </Button>
        </div>
        {list.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            No recipes yet. Press Record in the menu bar, do things in GFV, then press Stop.
          </p>
        )}
        {list.map((r) => (
          <button
            key={r.id}
            data-testid="recipe-row"
            className={cn(
              'block w-full border-b border-border/50 px-3 py-2 text-left hover:bg-accent',
              selectedId === r.id && 'bg-primary/15',
            )}
            onClick={() => {
              setSelectedId(r.id);
              setTab('steps');
            }}
          >
            <div className="truncate font-medium">{r.name}</div>
            <div className="text-xs text-muted-foreground">
              {r.stepCount} step{r.stepCount === 1 ? '' : 's'} · {serverName(r.serverId)}
              {recording?.recipeId === r.id && <span className="text-danger"> · recording</span>}
            </div>
          </button>
        ))}
      </div>

      <div className={`min-w-0 flex-1 flex-col ${compact && !selectedId ? 'hidden' : 'flex'}`}>
        {compact && selectedId && (
          <BackBar
            label="All recipes"
            onBack={() => {
              setSelectedId(null);
              setDetail(null);
            }}
          />
        )}
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
                variant={tab === 'params' ? 'default' : 'outline'}
                onClick={() => setTab('params')}
              >
                Parameters{detail.params.length ? ` (${detail.params.length})` : ''}
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
                disabled={!!isRecording || detail.steps.length === 0}
                title={
                  isRecording ? 'Stop recording first' : 'Run this recipe on one or more servers'
                }
                onClick={() => setRunOn(true)}
              >
                <Play size={13} /> Run on…
              </Button>
              <Button
                size="sm"
                variant="outline"
                title="Save this recipe as a file you can send to someone"
                onClick={() => void share()}
              >
                Share
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                disabled={!!isRecording}
                title={isRecording ? 'Stop recording first' : undefined}
                onClick={() => {
                  void confirmDialog({
                    title: `Delete the recipe "${detail.name}"?`,
                    body: 'Its steps are removed. Scripts you already exported are not affected.',
                    confirmLabel: 'Delete',
                    danger: true,
                  }).then((ok) => {
                    if (!ok) return;
                    return api.deleteRecipe(detail.id).then(() => {
                      setSelectedId(null);
                      return loadList();
                    });
                  });
                }}
              >
                Delete
              </Button>
            </div>
            {isRecording && (
              <p className="bg-danger/15 px-2 py-1 text-xs text-danger">
                <Circle size={9} fill="currentColor" className="mr-1 inline animate-pulse" />
                Recording on {serverName(detail.serverId)}: every successful action you run there is
                added as a step.
              </p>
            )}
            {note && (
              <p role="alert" className="px-2 py-1 text-xs text-danger">
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
                    const info = describeStep(s.actionId, s.params);
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
                            aria-label="Edit step parameters"
                            onClick={() => setEditingStep(editingStep === s.id ? null : s.id)}
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5"
                            aria-label="Move up"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5"
                            aria-label="Move down"
                            disabled={i === detail.steps.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-danger"
                            aria-label="Delete step"
                            onClick={() => void mutate(() => api.deleteStep(detail.id, s.id))}
                          >
                            <X size={13} />
                          </Button>
                        </div>
                        {info ? (
                          <>
                            <p className="my-1 text-xs text-muted-foreground">{info.explain}</p>
                            {info.commands.map((c, k) => (
                              <code
                                key={k}
                                className="mt-1 block whitespace-pre-wrap break-all rounded bg-code px-2 py-1 text-xs text-code-foreground"
                              >
                                $ {c}
                              </code>
                            ))}
                          </>
                        ) : (
                          <p className="text-xs text-danger">
                            This action is not available in this version of GFV. It will be skipped
                            in the script.
                          </p>
                        )}
                        {editingStep === s.id && (
                          <StepParamsEditor
                            recipeId={detail.id}
                            stepId={s.id}
                            params={s.params}
                            onDone={() => {
                              setEditingStep(null);
                              void loadDetail(detail.id);
                            }}
                          />
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
            ) : tab === 'params' ? (
              <ParamsEditor
                key={detail.id}
                recipe={detail}
                onSaved={() => void loadDetail(detail.id)}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
                  <label className="flex items-center gap-1.5 text-footnote">
                    Format
                    <select
                      aria-label="Export format"
                      value={format}
                      onChange={(e) => setFormat(e.target.value as ExportFormat)}
                    >
                      {EXPORT_FORMATS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {script && script.files.length > 1 && (
                    <div role="tablist" aria-label="Files" className="flex gap-1">
                      {script.files.map((f, i) => (
                        <Button
                          key={f.name}
                          role="tab"
                          aria-selected={i === fileIndex}
                          size="sm"
                          variant={i === fileIndex ? 'default' : 'outline'}
                          onClick={() => setFileIndex(i)}
                        >
                          {f.name}
                        </Button>
                      ))}
                    </div>
                  )}
                  <Button
                    size="sm"
                    disabled={!file}
                    onClick={() => file && void navigator.clipboard?.writeText(file.content)}
                  >
                    Copy
                  </Button>
                  <Button size="sm" variant="outline" disabled={!file} onClick={download}>
                    Download {file?.name}
                  </Button>
                  {format === 'bash' && (
                    <span className="text-footnote text-muted-foreground">
                      Run it on a server with: bash {script?.filename}
                    </span>
                  )}
                </div>
                {script && script.notes.length > 0 && (
                  <ul
                    aria-label="Notes about this export"
                    className="shrink-0 border-b border-border bg-warning/10 px-3 py-1.5 text-footnote"
                  >
                    {script.notes.map((n) => (
                      <li key={n}>• {n}</li>
                    ))}
                  </ul>
                )}
                <pre
                  data-testid="script-view"
                  className="min-h-0 flex-1 overflow-auto bg-code p-3 font-mono text-xs text-code-foreground"
                >
                  {file?.content ?? 'Generating…'}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
      {runOn && detail && (
        <PlanDialog source={{ kind: 'replay', recipe: detail }} onClose={() => setRunOn(false)} />
      )}
      {library && (
        <LibraryDialog
          onClose={() => setLibrary(false)}
          onImported={(id) => {
            setSelectedId(id);
            setTab('steps');
            void loadList();
          }}
        />
      )}
    </div>
  );
}
