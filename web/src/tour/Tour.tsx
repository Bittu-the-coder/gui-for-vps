import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { TOUR_STEPS, useTour } from './tourStore';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A guided walk-through: dims the screen, rings one element, and explains it. No dependency. */
export function Tour() {
  const { open, step, next, back, finish } = useTour();
  const [box, setBox] = useState<Box | null>(null);
  const s = TOUR_STEPS[step];

  useEffect(() => {
    if (!open || !s) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${s.target}"]`);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ x: r.x, y: r.y, w: r.width, h: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, s]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open || !s) return null;

  const pad = 6;
  // Put the card next to the element, kept inside the screen: under things in the menu bar (top),
  // above things in the Dock (bottom), beside anything else.
  const cardW = 300;
  const clampX = (x: number) => Math.min(Math.max(8, x), window.innerWidth - cardW - 8);
  let style: { left: number; top?: number; bottom?: number };
  if (!box) style = { left: window.innerWidth / 2 - cardW / 2, top: window.innerHeight / 2 - 80 };
  else if (box.y < 48) style = { left: clampX(box.x), top: box.y + box.h + pad + 12 };
  else if (box.y > window.innerHeight / 2)
    style = { left: clampX(box.x), bottom: window.innerHeight - box.y + pad + 12 };
  else style = { left: clampX(box.x + box.w + 14), top: Math.max(8, box.y) };

  return (
    <div className="fixed inset-0 z-[300000]" role="dialog" aria-label="Tour">
      {box ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-sky-400"
          style={{
            left: box.x - pad,
            top: box.y - pad,
            width: box.w + pad * 2,
            height: box.h + pad * 2,
            boxShadow: '0 0 0 9999px rgba(2,6,23,0.65)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/65" />
      )}
      <div
        className="absolute rounded-lg border border-border bg-background p-4 text-foreground shadow-2xl"
        style={{ ...style, width: cardW }}
      >
        <p className="text-xs text-muted-foreground">
          Step {step + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="mt-1 font-semibold">{s.title}</h2>
        <p className="mt-1 text-sm">{s.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button className="text-xs text-muted-foreground underline" onClick={finish}>
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="secondary" onClick={back}>
                Back
              </Button>
            )}
            <Button size="sm" autoFocus onClick={next}>
              {step === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
