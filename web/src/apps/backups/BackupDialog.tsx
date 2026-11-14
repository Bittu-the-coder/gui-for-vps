import { backupSchema } from '@gfv/shared';
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
import { requestRun } from '../../runner/runStore';

const SELECT =
  'h-9 rounded-control border border-border bg-background px-2 text-body focus-visible:outline-offset-1';

/** Collects a schedule. It only COLLECTS: the Run dialog shows the exact commands and the server validates again. */
export function BackupDialog({
  serverId,
  onClose,
  onDone,
}: {
  serverId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [paths, setPaths] = useState('/etc');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [hour, setHour] = useState('3');
  const [keep, setKeep] = useState('7');
  const [problem, setProblem] = useState('');

  const submit = () => {
    const parsed = backupSchema.safeParse({
      name: name.trim().toLowerCase(),
      paths: paths
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
      frequency,
      hour: Number(hour),
      keep: Number(keep),
    });
    if (!parsed.success)
      return setProblem(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('. '),
      );
    requestRun({ serverId, actionId: 'backup.schedule', params: parsed.data, onDone });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a backup</DialogTitle>
          <DialogDescription>
            The server packs the folders into an archive on a schedule and keeps the newest few. You
            will see the exact commands before anything runs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-name">Name (lowercase letters, digits, dashes)</Label>
            <Input
              id="bk-name"
              placeholder="website"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-paths">Folders to back up (one per line)</Label>
            <textarea
              id="bk-paths"
              rows={3}
              className="rounded-control border border-border bg-background p-2 font-mono text-footnote focus-visible:outline-offset-1"
              value={paths}
              onChange={(e) => setPaths(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-freq">How often</Label>
              <select
                id="bk-freq"
                className={SELECT}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every Monday</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-hour">At hour (0-23, server time)</Label>
              <Input
                id="bk-hour"
                inputMode="numeric"
                value={hour}
                onChange={(e) => setHour(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bk-keep">Keep the newest</Label>
              <Input
                id="bk-keep"
                inputMode="numeric"
                value={keep}
                onChange={(e) => setKeep(e.target.value)}
              />
            </div>
          </div>
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
          <Button onClick={submit}>Review…</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
