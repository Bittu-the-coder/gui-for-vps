import { useCallback, useEffect, useState } from 'react';
import { Button } from './components/ui/button';
import { UnlockScreen } from './components/UnlockScreen';
import { Desktop } from './desktop/Desktop';
import { useDesktop } from './desktop/windowStore';
import { useServers } from './stores/serverStore';

export function App() {
  const theme = useDesktop((s) => s.theme);
  const { vault, refreshVault } = useServers();

  // Tailwind's `dark:` variant keys off this class on <html>. Lives here (not in Desktop)
  // so the unlock screen is themed too.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const [unreachable, setUnreachable] = useState(false);
  const load = useCallback(() => {
    setUnreachable(false);
    refreshVault().catch(() => setUnreachable(true));
  }, [refreshVault]);
  useEffect(load, [load]);

  if (!vault)
    return unreachable ? (
      <main className="grid h-screen place-items-center p-4 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <p className="text-lg font-semibold">Can’t reach the GFV server</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            GFV may have stopped, or this page is from an old session. Start it again with{' '}
            <code>npx gfv</code> and open the address it prints.
          </p>
          <Button onClick={load}>Try again</Button>
        </div>
      </main>
    ) : (
      <main className="grid h-screen place-items-center text-sm text-slate-500">Loading…</main>
    );
  if (!vault.unlocked) return <UnlockScreen initialized={vault.initialized} />;
  return <Desktop />;
}
