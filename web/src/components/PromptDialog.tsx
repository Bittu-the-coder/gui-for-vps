import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

export interface PromptSpec {
  title: string;
  description?: string;
  label: string;
  initial?: string;
  submitLabel: string;
  /** Optional extra tick box (e.g. "Apply to everything inside"). */
  checkbox?: string;
  /** Return an error message, or null when the value is fine. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string, checked: boolean) => void;
}

/** A small "type a value" dialog (new folder name, new permissions...). */
export function PromptDialog({ spec, onClose }: { spec: PromptSpec; onClose: () => void }) {
  const [value, setValue] = useState(spec.initial ?? '');
  const [checked, setChecked] = useState(false);
  const error = value ? (spec.validate?.(value) ?? null) : null;
  const ok = value.length > 0 && !error;

  const submit = () => {
    if (!ok) return;
    spec.onSubmit(value, checked);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={spec.description ? undefined : undefined}>
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          {spec.description && <DialogDescription>{spec.description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-value">{spec.label}</Label>
            <Input
              id="prompt-value"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>
          {spec.checkbox && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              {spec.checkbox}
            </label>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok}>
              {spec.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
