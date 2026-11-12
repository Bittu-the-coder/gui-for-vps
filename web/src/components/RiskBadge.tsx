import type { Risk } from '@gfv/shared';
import { cn } from '../lib/utils';

const STYLE: Record<Risk, string> = {
  safe: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  caution: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  danger: 'bg-red-500/20 text-red-700 dark:text-red-300',
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span className={cn('rounded px-1.5 py-px text-[10px] font-semibold uppercase', STYLE[risk])}>
      {risk}
    </span>
  );
}
