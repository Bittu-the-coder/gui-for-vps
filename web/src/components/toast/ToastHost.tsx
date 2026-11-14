import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLearn } from '../../stores/learnStore';
import { useToasts, type Toast } from '../../stores/toastStore';

const ICON = {
  info: <Info size={16} className="text-link" />,
  success: <CheckCircle2 size={16} className="text-success" />,
  error: <AlertTriangle size={16} className="text-danger" />,
};

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [hover, setHover] = useState(false);
  // The timer pauses while the pointer is over the toast, so it never vanishes as you read it.
  useEffect(() => {
    if (hover || t.ttl === 0) return;
    const id = setTimeout(() => dismiss(t.id), t.ttl);
    return () => clearTimeout(id);
  }, [hover, t.ttl, t.id, dismiss]);

  return (
    <div
      role={t.kind === 'error' ? 'alert' : 'status'}
      data-toast={t.kind}
      className="toast-in glass-popover pointer-events-auto flex w-80 items-start gap-2.5 rounded-xl border border-separator p-3 text-body text-foreground shadow-elev-3"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <span className="mt-0.5 shrink-0">{ICON[t.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t.title}</p>
        {t.body && (
          <p className="mt-0.5 break-words text-footnote text-muted-foreground">{t.body}</p>
        )}
        {t.action && (
          <button
            className="mt-1.5 text-footnote font-medium text-link hover:underline"
            onClick={() => {
              t.action!.run();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 text-faint-foreground hover:bg-foreground/10 hover:text-foreground"
        onClick={() => dismiss(t.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Notifications stack in the top-right, under the menu bar (left of the Learn panel when it is docked). */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const learnOpen = useLearn((s) => s.open);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed z-[215000] flex flex-col gap-2"
      style={{ top: 'calc(var(--menubar-h) + 10px)', right: learnOpen ? 'calc(20rem + 12px)' : 12 }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
