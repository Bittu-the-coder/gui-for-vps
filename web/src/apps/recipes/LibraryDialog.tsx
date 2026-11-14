import { inspectRecipeFile, type DescribedStep } from '@gfv/shared';
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
import { ApiError, api, type LibraryEntry } from '../../lib/api';
import { toast } from '../../stores/toastStore';

function Steps({ steps }: { steps: DescribedStep[] }) {
  return (
    <ol className="mt-1 flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <li key={i}>
          <p className="flex items-center gap-1.5 text-footnote font-medium">
            {i + 1}. {s.title} <RiskBadge risk={s.risk} />
          </p>
          {s.commands.map((c, k) => (
            <code
              key={k}
              className="mt-0.5 block whitespace-pre-wrap break-all rounded-md bg-code px-2 py-1 text-caption text-code-foreground"
            >
              $ {c}
            </code>
          ))}
        </li>
      ))}
    </ol>
  );
}

/**
 * Starter recipes that ship with GFV, and recipe files from anywhere. A file is UNTRUSTED: you see every command and
 * its risk before importing, and the server validates it again. Replaying it still shows the plan per server.
 */
export function LibraryDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (recipeId: string) => void;
}) {
  const [tab, setTab] = useState<'starter' | 'file'>('starter');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .library()
      .then(setEntries)
      .catch(() => setError('Could not load the starter recipes.'));
  }, []);

  const inspected = useMemo(() => (text.trim() ? inspectRecipeFile(text) : null), [text]);

  const done = (recipeId: string, name: string) => {
    toast({ kind: 'success', title: `Added “${name}” to your recipes` });
    onImported(recipeId);
    onClose();
  };
  const fail = (e: unknown) => {
    const b = e instanceof ApiError ? (e.body as { problems?: string[] }) : null;
    setError(b?.problems?.join(' ') ?? 'That did not work.');
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recipe library</DialogTitle>
          <DialogDescription>
            Starter recipes, or a recipe file someone shared. Nothing runs until you replay it on a
            server and confirm its plan.
          </DialogDescription>
        </DialogHeader>
        <div role="tablist" className="flex gap-1">
          <Button
            role="tab"
            aria-selected={tab === 'starter'}
            size="sm"
            variant={tab === 'starter' ? 'default' : 'outline'}
            onClick={() => setTab('starter')}
          >
            Starter recipes
          </Button>
          <Button
            role="tab"
            aria-selected={tab === 'file'}
            size="sm"
            variant={tab === 'file' ? 'default' : 'outline'}
            onClick={() => setTab('file')}
          >
            From a file
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}

        {tab === 'starter' ? (
          <ul className="flex max-h-80 flex-col gap-2 overflow-auto">
            {entries.map((e) => (
              <li
                key={e.id}
                data-testid="library-entry"
                className="rounded-xl border border-separator p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{e.name}</span>
                  <RiskBadge risk={e.risk} />
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      api
                        .importLibraryRecipe(e.id)
                        .then((r) => done(r.recipeId, e.name))
                        .catch(fail)
                        .finally(() => setBusy(false));
                    }}
                  >
                    Add
                  </Button>
                </div>
                <p className="text-footnote text-muted-foreground">{e.description}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-footnote text-link">
                    {e.steps.length} steps, show commands
                  </summary>
                  <Steps steps={e.steps} />
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-footnote text-muted-foreground" htmlFor="recipe-file">
              Choose a <code>.gfv-recipe.json</code> file, or paste its contents.
            </label>
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Recipe file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(setText);
              }}
            />
            <textarea
              id="recipe-file"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="min-h-24 w-full rounded-control border border-input bg-background p-2 font-mono text-footnote"
              placeholder='{ "format": 1, "name": "…", "steps": [ … ] }'
            />
            {inspected && !inspected.ok && (
              <ul role="alert" className="text-footnote text-danger">
                {inspected.problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}
            {inspected?.ok && (
              <div
                className="max-h-64 overflow-auto rounded-xl border border-separator p-3"
                aria-label="File preview"
              >
                <p className="flex items-center gap-2 font-medium">
                  {inspected.file.name} <RiskBadge risk={inspected.risk} />
                </p>
                {inspected.file.description && (
                  <p className="text-footnote text-muted-foreground">
                    {inspected.file.description}
                  </p>
                )}
                <p className="mt-1 rounded-lg border border-warning bg-warning/10 p-2 text-footnote">
                  Unreviewed: read every command below. A recipe changes real servers when you
                  replay it.
                </p>
                <Steps steps={inspected.steps} />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {tab === 'file' && (
            <Button
              disabled={busy || !inspected?.ok}
              onClick={() => {
                if (!inspected?.ok) return;
                setBusy(true);
                api
                  .importRecipeFile(inspected.file)
                  .then((r) => done(r.recipeId, inspected.file.name))
                  .catch(fail)
                  .finally(() => setBusy(false));
              }}
            >
              Import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
