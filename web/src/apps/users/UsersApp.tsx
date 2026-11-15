import { Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { confirmDialog } from '../../components/confirmStore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../stores/authStore';
import { useServers } from '../../stores/serverStore';

type UserRow = Awaited<ReturnType<typeof api.users>>[number];
const errText = (e: unknown) =>
  e instanceof ApiError
    ? ((e.body as { message?: string })?.message ?? e.detail)
    : 'Something went wrong.';
const SELECT = 'h-8 rounded-control border border-border bg-background px-1 text-footnote';

/** Administrators only: accounts, which servers each member may use, and the audit log. */
export function UsersApp() {
  const status = useAuth((s) => s.status);
  const servers = useServers((s) => s.servers);
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof api.audit>>>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');

  const refresh = async () => {
    try {
      setUsers(await api.users());
      if (tab === 'audit') setAudit(await api.audit());
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    if (status?.user?.role === 'admin') void refresh();
  }, [tab]);

  if (!status?.hosted)
    return (
      <p className="p-6 text-center text-muted-foreground">
        Accounts exist in hosted mode (<code>gfv --hosted</code>). In local mode you are the only
        user.
      </p>
    );
  if (status.user?.role !== 'admin')
    return (
      <p className="p-6 text-center text-muted-foreground">
        Only administrators can manage accounts.
      </p>
    );

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="flex h-full flex-col text-body">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2" role="tablist">
        <UsersIcon size={18} className="mr-1 text-link" />
        {(['users', 'audit'] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
          >
            {t === 'users' ? 'Accounts' : 'Audit log'}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" data-testid="users-error" className="p-2 text-footnote text-danger">
          {error}
        </p>
      )}
      {tab === 'users' ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-3 grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2 rounded-xl border border-separator p-3 max-md:grid-cols-1">
            <div className="flex flex-col gap-1">
              <Label htmlFor="nu-name">New account: username</Label>
              <Input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="nu-pw">Password (12+ characters)</Label>
              <Input
                id="nu-pw"
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <select
              aria-label="Role for the new account"
              className={SELECT}
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="member">Member</option>
              <option value="admin">Administrator</option>
            </select>
            <Button
              size="sm"
              onClick={() =>
                void act(async () => {
                  await api.createUser({ username: name, password: pw, role });
                  setName('');
                  setPw('');
                })
              }
            >
              Create
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {users.map((u) => (
              <li
                key={u.id}
                data-testid="user-row"
                data-user={u.username}
                className="rounded-xl border border-separator p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.username}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-px text-caption text-link">
                    {u.role === 'admin' ? 'administrator' : 'member'}
                  </span>
                  {u.totpEnabled && (
                    <span className="rounded-full bg-success/10 px-2 py-px text-caption text-success">
                      2FA
                    </span>
                  )}
                  {u.disabled && (
                    <span className="rounded-full bg-warning/10 px-2 py-px text-caption text-warning">
                      disabled
                    </span>
                  )}
                  <span className="ml-auto flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(() => api.updateUser(u.id, { disabled: !u.disabled }))
                      }
                    >
                      {u.disabled ? 'Enable' : 'Disable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(() =>
                          api.updateUser(u.id, { role: u.role === 'admin' ? 'member' : 'admin' }),
                        )
                      }
                    >
                      Make {u.role === 'admin' ? 'member' : 'administrator'}
                    </Button>
                    {u.totpEnabled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void act(() => api.resetUser2fa(u.id))}
                      >
                        Reset 2FA
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() =>
                        void confirmDialog({
                          title: `Delete ${u.username}?`,
                          body: 'Their sessions end and their access is removed.',
                          confirmLabel: 'Delete',
                        }).then((ok) => {
                          if (ok) void act(() => api.deleteUser(u.id));
                        })
                      }
                    >
                      Delete
                    </Button>
                  </span>
                </div>
                {u.role === 'member' ? (
                  <fieldset className="mt-2">
                    <legend className="text-caption font-semibold uppercase tracking-wide text-faint-foreground">
                      Servers {u.username} may use
                    </legend>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {servers.length === 0 && (
                        <span className="text-footnote text-muted-foreground">No servers yet.</span>
                      )}
                      {servers.map((s) => (
                        <label key={s.id} className="flex items-center gap-1.5 text-footnote">
                          <input
                            type="checkbox"
                            checked={u.serverIds.includes(s.id)}
                            onChange={(e) =>
                              void act(() =>
                                api.setUserAccess(
                                  u.id,
                                  e.target.checked
                                    ? [...u.serverIds, s.id]
                                    : u.serverIds.filter((x) => x !== s.id),
                                ),
                              )
                            }
                          />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <p className="mt-1 text-footnote text-muted-foreground">
                    Administrators can use every server and manage accounts.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-footnote" data-testid="audit-table">
            <thead className="sticky top-0 bg-sunken text-left">
              <tr>
                <th className="w-40 px-2 py-1">When</th>
                <th className="w-24 px-2 py-1">Who</th>
                <th className="px-2 py-1">What</th>
                <th className="w-28 px-2 py-1">From</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-b border-border/50">
                  <td className="px-2 py-1">{new Date(a.at).toLocaleString()}</td>
                  <td className="truncate px-2 py-1">{a.username ?? '—'}</td>
                  <td className="truncate px-2 py-1" title={a.detail ?? ''}>
                    <span className={a.ok ? '' : 'text-danger'}>{a.event}</span>
                    {a.detail && <span className="text-muted-foreground"> · {a.detail}</span>}
                  </td>
                  <td className="truncate px-2 py-1 font-mono">{a.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && (
            <p className="p-4 text-center text-muted-foreground">Nothing recorded yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
