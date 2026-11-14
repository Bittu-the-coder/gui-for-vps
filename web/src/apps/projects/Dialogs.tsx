import {
  branchName,
  envKey,
  projectName,
  renderEnvFile,
  repoUrl,
  requiredUserCommand,
  userCommand,
  type ProjectInfo,
} from '@gfv/shared';
import { Plus, X } from 'lucide-react';
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
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';

interface Common {
  serverId: string;
  onClose: () => void;
  onDone: () => void;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-footnote text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** New project, or redeploy an existing one (its settings are filled in). The Run dialog then shows every command. */
export function DeployDialog({
  serverId,
  project,
  onClose,
  onDone,
}: Common & { project?: ProjectInfo }) {
  const [name, setName] = useState(project?.name ?? '');
  const [repo, setRepo] = useState(project?.repo ?? '');
  const [branch, setBranch] = useState(project?.branch ?? 'main');
  const [build, setBuild] = useState(project?.build ?? '');
  const [start, setStart] = useState(project?.start ?? '');
  const [problem, setProblem] = useState('');

  const submit = () => {
    const checks = [
      ['Name', projectName.safeParse(name)],
      ['Repository', repoUrl.safeParse(repo)],
      ['Branch', branchName.safeParse(branch)],
      ['Build command', userCommand.safeParse(build)],
      ['Start command', userCommand.safeParse(start)],
    ] as const;
    const bad = checks.find(([, r]) => !r.success);
    if (bad && !bad[1].success) return setProblem(`${bad[0]}: ${bad[1].error.issues[0]?.message}`);
    requestRun({
      serverId,
      actionId: 'projects.deploy',
      params: { name, repo, branch, ...(build ? { build } : {}), ...(start ? { start } : {}) },
      onDone,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? `Deploy ${project.name}` : 'New project'}</DialogTitle>
          <DialogDescription>
            Gets the code from git into <code>~/gfv-projects/{name || 'name'}</code> and runs your
            build command. The build command is the project’s own code running on your server: only
            deploy repositories you trust.
          </DialogDescription>
        </DialogHeader>
        <Field id="p-name" label="Name">
          <Input
            id="p-name"
            value={name}
            disabled={!!project}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
          />
        </Field>
        <Field
          id="p-repo"
          label="Repository"
          hint="https://github.com/you/repo.git, git@host:you/repo.git, or a path on the server. Private repositories need an SSH key on the server."
        >
          <Input
            id="p-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="https://github.com/you/repo.git"
          />
        </Field>
        <Field id="p-branch" label="Branch">
          <Input id="p-branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
        <Field
          id="p-build"
          label="Build command (optional)"
          hint="Runs inside the project folder after the code is updated, for example: npm ci && npm run build"
        >
          <Input id="p-build" value={build} onChange={(e) => setBuild(e.target.value)} />
        </Field>
        <Field
          id="p-start"
          label="Start command (optional)"
          hint="Remembered for “Run as a service”, for example: npm start"
        >
          <Input id="p-start" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        {problem && (
          <p role="alert" className="text-body text-danger">
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

/** Environment variables. Values are uploaded to a temp file (never put in a command or in history), then moved into place. */
export function EnvDialog({
  serverId,
  project,
  onClose,
  onDone,
}: Common & { project: ProjectInfo }) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>([{ k: '', v: '' }]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const filled = rows.filter((r) => r.k.trim() || r.v);
    for (const r of filled)
      if (!envKey.safeParse(r.k.trim()).success)
        return setProblem(
          `“${r.k}” is not a valid name: use letters, digits and _, not starting with a digit.`,
        );
    const env = renderEnvFile(Object.fromEntries(filled.map((r) => [r.k.trim(), r.v])));
    if (!env.ok) return setProblem(env.error);
    setBusy(true);
    try {
      const tmp = `/tmp/gfv-env-${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      await api.fsUpload(serverId, tmp, new File([env.text], 'env'));
      requestRun({
        serverId,
        actionId: 'projects.env.install',
        params: { name: project.name, tmp },
        onDone,
      });
      onClose();
    } catch {
      setProblem('Could not upload the variables to the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Environment for {project.name}</DialogTitle>
          <DialogDescription>
            Saving <b>replaces the whole .env file</b>
            {project.hasEnv ? ' (existing values are not shown, so enter them all again)' : ''}. The
            values travel in a temporary file, never in a command or GFV’s history, and the result
            is readable only by you (mode 600).
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-2">
              <Input
                aria-label={`Variable ${i + 1} name`}
                value={r.k}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))
                }
                placeholder="API_KEY"
                className="w-2/5 font-mono"
              />
              <Input
                aria-label={`Variable ${i + 1} value`}
                type="password"
                autoComplete="off"
                value={r.v}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))
                }
                placeholder="value"
                className="flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove variable ${i + 1}`}
                onClick={() =>
                  setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ k: '', v: '' }])
                }
              >
                <X size={14} />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setRows([...rows, { k: '', v: '' }])}
        >
          <Plus size={13} /> Add variable
        </Button>
        {problem && (
          <p role="alert" className="text-body text-danger">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            Review…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceDialog({
  serverId,
  project,
  onClose,
  onDone,
}: Common & { project: ProjectInfo }) {
  const [start, setStart] = useState(project.start ?? '');
  const [problem, setProblem] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run {project.name} as a service</DialogTitle>
          <DialogDescription>
            Creates a systemd service that runs this command in the project folder as your user,
            with the project’s .env, restarts it if it crashes, and starts it at boot.
          </DialogDescription>
        </DialogHeader>
        <Field
          id="svc-start"
          label="Start command"
          hint="For example: npm start, or node server.js. It must keep running (not exit)."
        >
          <Input id="svc-start" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        {problem && (
          <p role="alert" className="text-body text-danger">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const r = requiredUserCommand.safeParse(start);
              if (!r.success) return setProblem(`Start command: ${r.error.issues[0]?.message}`);
              requestRun({
                serverId,
                actionId: 'projects.service.install',
                params: { name: project.name, start },
                onDone,
              });
              onClose();
            }}
          >
            Review…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
