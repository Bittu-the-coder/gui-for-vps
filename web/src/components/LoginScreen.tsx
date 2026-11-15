import { useState, type FormEvent } from 'react';
import { Wallpaper } from '../desktop/Wallpaper';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../stores/authStore';
import { GfvMark } from './icons/GfvMark';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

/** Hosted mode: sign in (with an authenticator code when 2FA is on), or create the first administrator. */
export function LoginScreen({ setup }: { setup: boolean }) {
  const load = useAuth((s) => s.load);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (setup) await api.authSetup({ setupToken: setupToken.trim(), username, password });
      else await api.authLogin({ username, password, ...(code ? { code } : {}) });
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        const b = err.body as { error?: string; message?: string };
        if (b?.error === 'totp_required') {
          setNeedCode(true);
          setError('');
        } else setError(b?.message ?? err.detail);
      } else setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative grid h-screen place-items-center p-4">
      <Wallpaper />
      <form
        onSubmit={submit}
        className="glass-popover relative flex w-full max-w-sm flex-col gap-3 rounded-window border border-separator p-6 shadow-elev-3"
        aria-label={setup ? 'Create the administrator' : 'Sign in'}
      >
        <div className="flex items-center gap-2">
          <GfvMark />
          <h1 className="text-title font-semibold">
            {setup ? 'Welcome to GFV' : 'Sign in to GFV'}
          </h1>
        </div>
        {setup && (
          <>
            <p className="text-footnote text-muted-foreground">
              Create the administrator account. The setup token is printed on the server where GFV
              started: it proves you control the machine.
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="setup-token">Setup token</Label>
              <Input
                id="setup-token"
                autoComplete="off"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="login-user">Username</Label>
          <Input
            id="login-user"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="login-pass">Password{setup ? ' (at least 12 characters)' : ''}</Label>
          <Input
            id="login-pass"
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {needCode && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="login-code">
              Code from your authenticator app (or a recovery code)
            </Label>
            <Input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-footnote text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !username || !password}>
          {setup ? 'Create administrator' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
