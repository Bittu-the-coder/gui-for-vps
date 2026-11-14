import type { RecipeDetail, RecipeParam } from '@gfv/shared';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ApiError, api } from '../../lib/api';

function problemsOf(e: unknown): string[] {
  if (e instanceof ApiError) {
    const b = e.body as { problems?: string[]; error?: string; issues?: { message: string }[] };
    if (b?.problems?.length) return b.problems;
    if (b?.issues?.length) return b.issues.map((i) => i.message);
    return [e.detail];
  }
  return ['Could not reach the GFV server.'];
}

/** Edit one step's params as JSON. Put {{name}} inside a text value to make it a parameter. */
export function StepParamsEditor({
  recipeId,
  stepId,
  params,
  onDone,
}: {
  recipeId: string;
  stepId: string;
  params: unknown;
  onDone: () => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(params ?? {}, null, 2));
  const [problems, setProblems] = useState<string[]>([]);
  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return setProblems(['That is not valid JSON. Keep the quotes around names and text values.']);
    }
    try {
      await api.updateStep(recipeId, stepId, parsed);
      onDone();
    } catch (e) {
      setProblems(problemsOf(e));
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <label className="text-footnote text-muted-foreground" htmlFor={`sp-${stepId}`}>
        Parameters of this step. Write <code>{'{{name}}'}</code> inside a text value to ask for it
        when the recipe runs.
      </label>
      <textarea
        id={`sp-${stepId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="min-h-20 w-full rounded-control border border-input bg-background p-2 font-mono text-footnote"
      />
      {problems.map((p) => (
        <p key={p} role="alert" className="text-footnote text-danger">
          {p}
        </p>
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()}>
          Save step
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The recipe's declared parameters: what the person replaying it will be asked for. */
export function ParamsEditor({ recipe, onSaved }: { recipe: RecipeDetail; onSaved: () => void }) {
  const [rows, setRows] = useState<RecipeParam[]>(recipe.params);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<RecipeParam>) => {
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setSaved(false);
  };
  const save = async () => {
    // An empty default means "required".
    const clean = rows.map((r) => {
      const { default: d, ...rest } = r;
      return d === undefined || d === '' ? rest : { ...rest, default: d };
    });
    try {
      await api.setRecipeParams(recipe.id, clean);
      setProblems([]);
      setSaved(true);
      onSaved();
    } catch (e) {
      setProblems(problemsOf(e));
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <p className="mb-3 text-footnote text-muted-foreground">
        A parameter is a value asked for when the recipe runs: a domain name, a database password.
        Use it in a step as <code>{'{{name}}'}</code> (edit the step on the Steps tab). Secret
        values are never stored or logged. In an exported script each parameter is an environment
        variable named <code>GFV_NAME</code>.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li
            key={i}
            className="grid grid-cols-[1fr_1.4fr_1.2fr_auto_auto] items-end gap-2 rounded-xl border border-separator p-2"
            data-testid="param-row"
          >
            <label className="flex flex-col gap-1 text-footnote">
              Name
              <Input
                aria-label={`Parameter ${i + 1} name`}
                value={r.name}
                placeholder="domain"
                onChange={(e) => set(i, { name: e.target.value.toLowerCase() })}
              />
            </label>
            <label className="flex flex-col gap-1 text-footnote">
              Question
              <Input
                aria-label={`Parameter ${i + 1} label`}
                value={r.label}
                placeholder="Domain name"
                onChange={(e) => set(i, { label: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-footnote">
              Default
              <Input
                aria-label={`Parameter ${i + 1} default`}
                value={r.default ?? ''}
                placeholder={r.secret ? 'none (secret)' : 'required if empty'}
                disabled={!!r.secret}
                onChange={(e) => set(i, { default: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1 pb-2 text-footnote">
              <input
                type="checkbox"
                checked={!!r.secret}
                onChange={(e) =>
                  set(i, {
                    secret: e.target.checked,
                    ...(e.target.checked ? { default: undefined } : {}),
                  })
                }
              />
              Secret
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="mb-0.5 text-danger"
              aria-label={`Remove parameter ${i + 1}`}
              onClick={() => {
                setRows(rows.filter((_, k) => k !== i));
                setSaved(false);
              }}
            >
              <X size={14} />
            </Button>
          </li>
        ))}
      </ul>
      {problems.map((p) => (
        <p key={p} role="alert" className="mt-2 text-footnote text-danger">
          {p}
        </p>
      ))}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRows([...rows, { name: '', label: '' }]);
            setSaved(false);
          }}
        >
          <Plus size={13} /> Add parameter
        </Button>
        <Button size="sm" onClick={() => void save()}>
          Save parameters
        </Button>
        {saved && (
          <span role="status" className="text-footnote text-success">
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
