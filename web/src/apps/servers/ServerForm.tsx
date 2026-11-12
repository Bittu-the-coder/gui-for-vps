import type { Server } from '@gfv/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';

const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];

type Auth = 'key' | 'password';

/** Add (server = undefined) or edit a server. When editing, credentials are optional. */
export function ServerForm({
  open,
  server,
  onClose,
  onSaved,
}: {
  open: boolean;
  server?: Server;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!server;
  const [name, setName] = useState(server?.name ?? '');
  const [host, setHost] = useState(server?.host ?? '');
  const [port, setPort] = useState(String(server?.port ?? 22));
  const [username, setUsername] = useState(server?.username ?? '');
  const [color, setColor] = useState(server?.color ?? COLORS[0]!);
  const [authType, setAuthType] = useState<Auth>(server?.authType ?? 'key');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [password, setPassword] = useState('');
  const [changeCreds, setChangeCreds] = useState(!editing);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const credential = () =>
    authType === 'key'
      ? { authType, privateKey, ...(passphrase ? { passphrase } : {}) }
      : { authType, password };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const base = { name, host, port: Number(port), username, color };
      if (server) {
        await api.updateServer(server.id, {
          ...base,
          ...(changeCreds ? { credential: credential() } : {}),
        });
      } else {
        await api.createServer({ ...base, ...credential() });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not reach the GFV server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${server.name}` : 'Add a server'}</DialogTitle>
            <DialogDescription>
              Credentials are encrypted with your master password.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sf-name">Name</Label>
            <Input
              id="sf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My VPS"
            />
          </div>

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-host">Host</Label>
              <Input
                id="sf-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="203.0.113.10 or example.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-port">Port</Label>
              <Input
                id="sf-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sf-user">Username</Label>
            <Input
              id="sf-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-6 w-6 rounded-full border-2',
                    color === c ? 'border-foreground' : 'border-transparent',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={changeCreds}
                onChange={(e) => setChangeCreds(e.target.checked)}
              />
              Change stored credentials
            </label>
          )}

          {changeCreds && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Authentication</Label>
                <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1" role="radiogroup">
                  {(['key', 'password'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={authType === t}
                      onClick={() => setAuthType(t)}
                      className={cn(
                        'rounded px-3 py-1 text-sm',
                        authType === t ? 'bg-background shadow' : 'text-muted-foreground',
                      )}
                    >
                      {t === 'key' ? 'Private key' : 'Password'}
                    </button>
                  ))}
                </div>
              </div>

              {authType === 'key' ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="sf-key">Private key</Label>
                    <Textarea
                      id="sf-key"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      spellCheck={false}
                    />
                    <input
                      type="file"
                      aria-label="Load private key from file"
                      className="text-xs"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) setPrivateKey(await f.text());
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="sf-pass">Key passphrase (optional)</Label>
                    <Input
                      id="sf-pass"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sf-pw">Password</Label>
                  <Input
                    id="sf-pw"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="whitespace-pre-line text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
