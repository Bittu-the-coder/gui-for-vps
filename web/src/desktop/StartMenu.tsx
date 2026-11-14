import { AppIcon } from '../components/icons/AppIcon';
import { LAUNCHABLE } from '../apps/registry';
import { useTour } from '../tour/tourStore';
import { openApp } from './openApp';

export function StartMenu({
  onClose,
  onChangePassword,
}: {
  onClose: () => void;
  onChangePassword: () => void;
}) {
  const startTour = useTour((s) => s.start);
  const item =
    'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-200 dark:hover:bg-slate-800';
  return (
    <div className="absolute bottom-11 left-0 w-56 rounded-t-lg border border-slate-300 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {LAUNCHABLE.map((a) => (
        <button
          key={a.id}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
          onClick={() => {
            openApp(a);
            onClose();
          }}
        >
          <AppIcon app={a} size={20} />
          {a.title}
        </button>
      ))}
      <div className="my-1 border-t border-slate-300 dark:border-slate-700" />
      <button
        className={item}
        onClick={() => {
          startTour();
          onClose();
        }}
      >
        <span>🧭</span>Take the tour
      </button>
      <button
        className={item}
        onClick={() => {
          onChangePassword();
          onClose();
        }}
      >
        <span>🔑</span>Change master password…
      </button>
    </div>
  );
}
