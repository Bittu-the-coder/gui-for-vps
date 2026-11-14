import { Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
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

/** Change the master password: every saved credential is re-encrypted with the new one. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw.length < 8) return setError('The new password needs at least 8 characters.');
    if (newPw !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await api.changePassword(oldPw, newPw);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('The current password is wrong.');
      else if (err instanceof ApiError && err.status === 429) {
        const s = (err.body as { retryAfterSec?: number })?.retryAfterSec ?? 5;
        setError(`Too many wrong attempts. Wait ${s} seconds.`);
      } else setError(err instanceof ApiError ? err.detail : 'Could not reach the GFV server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change master password</DialogTitle>
          <DialogDescription>
            Your saved SSH keys and passwords are re-encrypted with the new password. There is no
            recovery if you forget it.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <p role="status" className="text-sm text-success">
              <Check size={14} className="mr-1 inline -mt-0.5" />
              Master password changed.
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={submit}>
            {[
              ['Current password', oldPw, setOldPw, 'current-password'],
              ['New password', newPw, setNewPw, 'new-password'],
              ['Confirm new password', confirm, setConfirm, 'new-password'],
            ].map(([label, value, set, ac]) => (
              <div key={label as string} className="flex flex-col gap-1.5">
                <Label>{label as string}</Label>
                <Input
                  type="password"
                  autoComplete={ac as string}
                  value={value as string}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                />
              </div>
            ))}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !oldPw || !newPw}>
                {busy ? 'Working…' : 'Change password'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
