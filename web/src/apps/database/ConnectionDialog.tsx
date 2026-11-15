import { connectionSchema, type PublicConnection } from '@gfv/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ApiError, api } from '../../lib/api';

export function ConnectionDialog({
  serverId,
  onClose,
  onSaved,
}: {
  serverId: string;
  onClose: () => void;
  onSaved: (c: PublicConnection) => void;
}) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('postgres');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');

  const save = async () => {
    const parsed = connectionSchema.safeParse({
      name,
      host,
      port: Number(port),
      database,
      user,
      password,
    });
    if (!parsed.success)
      return setProblem(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. '),
      );
    try {
      onSaved(await api.dbCreate(serverId, parsed.data));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.detail : 'Could not save.');
    }
  };

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    type = 'text',
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        autoComplete="off"
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New database connection</DialogTitle>
          <DialogDescription>
            The host is where the database listens <b>as seen from the server</b> (usually
            127.0.0.1). The password is encrypted with your master password.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field('db-name', 'Name', name, setName)}
          {field('db-host', 'Host', host, setHost)}
          {field('db-port', 'Port', port, setPort)}
          {field('db-database', 'Database', database, setDatabase)}
          {field('db-user', 'User', user, setUser)}
          {field('db-password', 'Password', password, setPassword, 'password')}
        </div>
        {problem && (
          <p role="alert" className="text-footnote text-danger">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
