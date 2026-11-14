import type { Risk } from '@gfv/shared';
import { cn } from '../lib/utils';

// Text colours are the contrast-checked status tokens; the fill is the same colour, faint.
const STYLE: Record<Risk, string> = {
  safe: 'bg-success/10 text-success',
  caution: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-px text-caption font-semibold uppercase tracking-wide',
        STYLE[risk],
      )}
    >
      {risk}
    </span>
  );
}
