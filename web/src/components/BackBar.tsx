import { ChevronLeft } from 'lucide-react';

/** On a phone a list + detail app shows one pane at a time: this bar goes from the detail back to the list. */
export function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      className="flex min-h-10 w-full shrink-0 items-center gap-1 border-b border-border px-2 text-left text-body text-link"
      onClick={onBack}
    >
      <ChevronLeft size={18} />
      {label}
    </button>
  );
}
