import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useServers } from '../stores/serverStore';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

/** Blocks the whole desktop until the vault is created (first run) or unlocked. */
export function UnlockScreen({ initialized }: { initialized: boolean }) {
  const { unlock, createVault } = useServers();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // After a 429 the button stays off until the server would accept another try.
  const [waitUntil, setWaitUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), waitUntil - Date.now() + 50);
    return () => clearTimeout(t);
  }, [waitUntil]);
  const waiting = waitUntil > Date.now();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!initialized && password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await (initialized ? unlock(password) : createVault(password));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const sec = (err.body as { retryAfterSec?: number })?.retryAfterSec ?? 5;
        setWaitUntil(Date.now() + sec * 1000);
        setError(
          `Too many wrong attempts. Wait ${sec} second${sec === 1 ? '' : 's'}, then try again.`,
        );
      } else {
        setError(
          err instanceof ApiError && err.status === 401
            ? 'Wrong master password.'
            : err instanceof ApiError
              ? err.detail
              : 'Could not reach the GFV server.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid h-screen w-screen place-items-center bg-gradient-to-br from-sky-200 to-indigo-300 p-4 dark:from-slate-900 dark:to-indigo-950">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-background p-6 text-foreground shadow-xl"
      >
        <div>
          <h1 className="text-xl font-semibold">{initialized ? 'Unlock GFV' : 'Welcome to GFV'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {initialized
              ? 'Enter your master password to unlock your saved servers.'
              : 'Choose a master password. It encrypts your SSH keys and passwords on this computer.'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="mp">Master password</Label>
          <Input
            id="mp"
            type="password"
            autoFocus
            autoComplete={initialized ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {!initialized && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mp2">Confirm password</Label>
              <Input
                id="mp2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              ⚠️ There is no password recovery. If you forget it, you will have to add your servers
              again.
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !password || waiting}>
          {busy ? 'Working…' : initialized ? 'Unlock' : 'Create vault'}
        </Button>
      </form>
    </main>
  );
}
