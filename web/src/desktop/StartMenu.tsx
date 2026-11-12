import { APPS } from '../apps/registry';
import { openApp } from './openApp';

export function StartMenu({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute bottom-11 left-0 w-56 rounded-t-lg border border-slate-300 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {APPS.map((a) => (
        <button
          key={a.id}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
          onClick={() => {
            openApp(a);
            onClose();
          }}
        >
          <span>{a.icon}</span>
          {a.title}
        </button>
      ))}
    </div>
  );
}
