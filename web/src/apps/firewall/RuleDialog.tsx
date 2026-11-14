import { blocksSsh, ruleSchema, type FirewallStatus } from '@gfv/shared';
import { ShieldAlert } from 'lucide-react';
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

/** Collects a rule. It only COLLECTS: the Run dialog shows the exact commands and the server validates again. */
export function RuleDialog({
  serverId,
  status,
  onClose,
  onDone,
}: {
  serverId: string;
  status: FirewallStatus | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [policy, setPolicy] = useState<'allow' | 'deny' | 'limit'>('allow');
  const [port, setPort] = useState('80');
  const [proto, setProto] = useState<'tcp' | 'udp' | 'any'>('tcp');
  const [from, setFrom] = useState('');
  const [problem, setProblem] = useState('');

  const spec = {
    policy,
    ...(port.trim() ? { port: port.trim() } : {}),
    proto,
    from: from.trim() || 'any',
  };
  const parsed = ruleSchema.safeParse(spec);
  const risky = parsed.success && blocksSsh(parsed.data, status?.sshPort, status?.clientIp);

  const submit = () => {
    if (!parsed.success) return setProblem(parsed.error.issues.map((i) => i.message).join('. '));
    requestRun({ serverId, actionId: 'firewall.allow', params: parsed.data, onDone });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a firewall rule</DialogTitle>
          <DialogDescription>
            Rules decide which connections may reach this server. You will see the exact commands
            before anything runs.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="fw-policy">What to do</Label>
            <select
              id="fw-policy"
              className={SELECT}
              value={policy}
              onChange={(e) => setPolicy(e.target.value as typeof policy)}
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny (drop)</option>
              <option value="limit">Limit (allow, but slow down abusers)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fw-proto">Protocol</Label>
            <select
              id="fw-proto"
              className={SELECT}
              value={proto}
              onChange={(e) => setProto(e.target.value as typeof proto)}
            >
              <option value="tcp">TCP (web, SSH, databases)</option>
              <option value="udp">UDP (DNS, games, VPN)</option>
              <option value="any">Both</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fw-port">Port (or a range like 8000:8100)</Label>
            <Input id="fw-port" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fw-from">From (empty = anywhere)</Label>
            <Input
              id="fw-from"
              placeholder="203.0.113.7 or 10.0.0.0/8"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
        </div>
        {risky && (
          <p
            role="alert"
            data-testid="rule-lockout-hint"
            className="flex gap-2 rounded border border-danger bg-danger/10 p-2 text-footnote"
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
            This rule matches SSH, the way GFV reaches this server. GFV will notice if it cuts the
            connection and the server undoes the change by itself.
          </p>
        )}
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
