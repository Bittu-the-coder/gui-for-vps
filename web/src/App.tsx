import { useEffect } from 'react';
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

  useEffect(() => {
    void refreshVault().catch(() => {});
  }, [refreshVault]);

  if (!vault)
    return (
      <main className="grid h-screen place-items-center text-sm text-slate-500">Loading…</main>
    );
  if (!vault.unlocked) return <UnlockScreen initialized={vault.initialized} />;
  return <Desktop />;
}
