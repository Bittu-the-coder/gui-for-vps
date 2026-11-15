import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Button } from './components/ui/button';
import { LoginScreen } from './components/LoginScreen';
import { UnlockScreen } from './components/UnlockScreen';
import { Desktop } from './desktop/Desktop';
import { useDesktop } from './desktop/windowStore';
import { useAppearance } from './stores/appearanceStore';
import { useAuth } from './stores/authStore';
import { useServers } from './stores/serverStore';

export function App() {
  const theme = useDesktop((s) => s.theme);
  const { vault, refreshVault } = useServers();
  const auth = useAuth((s) => s.status);
  const loadAuth = useAuth((s) => s.load);

  // Tailwind's `dark:` variant keys off this class on <html>. Lives here (not in Desktop)
  // so the unlock screen is themed too.
  // A LAYOUT effect: it must run before children's effects, which read the theme's CSS variables
  // (the charts draw on a canvas and pick their colours from the tokens when the theme changes).
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const reduceTransparency = useAppearance((s) => s.reduceTransparency);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-transparency', reduceTransparency);
  }, [reduceTransparency]);

  const [unreachable, setUnreachable] = useState(false);
  const load = useCallback(() => {
    setUnreachable(false);
    loadAuth()
      // Hosted mode: the vault is behind the sign-in, so ask for it only once someone is signed in.
      .then((status) => (!status.hosted || status.user ? refreshVault() : undefined))
      .catch(() => setUnreachable(true));
  }, [refreshVault, loadAuth]);
  useEffect(load, [load]);
  // Signing in (hosted mode) makes the vault state available.
  const signedInId = auth?.user?.id;
  useEffect(() => {
    if (signedInId) refreshVault().catch(() => setUnreachable(true));
  }, [signedInId, refreshVault]);

  // Hosted mode: sign in first. (Local mode answers `hosted: false` and skips all of this.)
  if (auth?.hosted && auth.setupNeeded) return <LoginScreen setup />;
  if (auth?.hosted && !auth.user) return <LoginScreen setup={false} />;

  if (!vault || !auth)
    return unreachable ? (
      <main className="grid h-screen place-items-center p-4 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <p className="text-lg font-semibold">Can’t reach the GFV server</p>
          <p className="text-sm text-muted-foreground">
            GFV may have stopped, or this page is from an old session. Start it again with{' '}
            <code>npx gfv</code> and open the address it prints.
          </p>
          <Button onClick={load}>Try again</Button>
        </div>
      </main>
    ) : (
      <main className="grid h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  if (!vault.unlocked) {
    // Only an administrator can create or unlock the vault in hosted mode.
    if (auth.hosted && auth.user?.role !== 'admin')
      return (
        <main className="grid h-screen place-items-center p-4 text-center">
          <div className="flex max-w-sm flex-col items-center gap-3">
            <p className="text-lg font-semibold">GFV is locked</p>
            <p className="text-sm text-muted-foreground">
              An administrator has to unlock it with the master password before servers can be used.
            </p>
            <Button onClick={() => void useAuth.getState().logout()}>Sign out</Button>
          </div>
        </main>
      );
    return <UnlockScreen initialized={vault.initialized} />;
  }
  return <Desktop />;
}
