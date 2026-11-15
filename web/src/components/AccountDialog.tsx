import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../stores/authStore';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

const errText = (e: unknown) =>
  e instanceof ApiError
    ? ((e.body as { message?: string })?.message ?? e.detail)
    : 'Something went wrong.';

/** Hosted mode: my password, two-factor authentication and the devices I am signed in on. */
export function AccountDialog() {
  const open = useAuth((s) => s.accountOpen);
  const user = useAuth((s) => s.status?.user);
  const setOpen = useAuth((s) => s.setAccountOpen);
  const load = useAuth((s) => s.load);
  const logout = useAuth((s) => s.logout);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof api.mySessions>>>([]);
  const [enrol, setEnrol] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [disablePw, setDisablePw] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (open)
      void api
        .mySessions()
        .then(setSessions)
        .catch(() => {});
  }, [open]);
  if (!open || !user) return null;

  const run = async (fn: () => Promise<void>) => {
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account: {user.username}</DialogTitle>
          <DialogDescription>
            {user.role === 'admin' ? 'Administrator' : 'Member'} ·{' '}
            {user.totpEnabled
              ? 'two-factor authentication is on'
              : 'two-factor authentication is off'}
          </DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="text-footnote font-semibold uppercase text-muted-foreground">
            Two-factor authentication
          </h3>
          {recovery ? (
            <div
              data-testid="recovery-codes"
              className="rounded-lg border border-warning bg-warning/10 p-2 text-footnote"
            >
              <p className="font-semibold">
                Save these recovery codes now. Each works once if you lose your phone. They are not
                shown again.
              </p>
              <p className="mt-1 grid grid-cols-2 gap-1 font-mono select-all">
                {recovery.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </p>
              <Button size="sm" className="mt-2" onClick={() => setRecovery(null)}>
                I saved them
              </Button>
            </div>
          ) : user.totpEnabled ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="acct-disable-pw">Password</Label>
                <Input
                  id="acct-disable-pw"
                  type="password"
                  value={disablePw}
                  onChange={(e) => setDisablePw(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void run(async () => {
                    await api.twoFaDisable(disablePw);
                    setDisablePw('');
                    await load();
                  })
                }
              >
                Turn off 2FA
              </Button>
            </div>
          ) : enrol ? (
            <div className="flex flex-col gap-2 text-footnote">
              <p>
                In your authenticator app choose “enter a setup key” and type this key (or open the
                link on your phone):
              </p>
              <code
                data-testid="totp-secret"
                className="select-all rounded bg-sunken p-2 font-mono"
              >
                {enrol.secret}
              </code>
              <a className="text-link underline" href={enrol.otpauth}>
                Open in authenticator app
              </a>
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="acct-code">6-digit code</Label>
                  <Input
                    id="acct-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      const r = await api.twoFaConfirm(code);
                      setRecovery(r.recoveryCodes);
                      setEnrol(null);
                      setCode('');
                      await load();
                    })
                  }
                >
                  Confirm
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => void run(async () => setEnrol(await api.twoFaBegin()))}
            >
              Set up 2FA
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-footnote font-semibold uppercase text-muted-foreground">
            Change password
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="acct-old">Current password</Label>
              <Input
                id="acct-old"
                type="password"
                autoComplete="current-password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="acct-new">New password (12+ characters)</Label>
              <Input
                id="acct-new"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() =>
              void run(async () => {
                await api.authPassword(oldPw, newPw);
                await load();
              })
            }
          >
            Change password (signs out every device)
          </Button>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-footnote font-semibold uppercase text-muted-foreground">
            Signed in on
          </h3>
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-footnote">
              <span className="min-w-0 flex-1 truncate">
                {s.current ? 'This device · ' : ''}
                {s.ip ?? 'unknown address'} · last active {new Date(s.lastSeen).toLocaleString()}
              </span>
              {!s.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() =>
                    void run(async () => {
                      await api.revokeSession(s.id);
                      setSessions(await api.mySessions());
                    })
                  }
                >
                  Sign out
                </Button>
              )}
            </div>
          ))}
        </section>

        {msg && (
          <p role="alert" data-testid="account-error" className="text-footnote text-danger">
            {msg}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
