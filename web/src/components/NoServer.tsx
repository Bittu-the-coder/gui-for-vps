export function NoServer({ app }: { app: string }) {
  return (
    <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
      Pick a server in the taskbar, then open a new {app} window.
    </div>
  );
}

/** Turns a failed query into text a beginner can act on. */
export function queryProblem(exitCode: number, stderr: string, tool: string): string | null {
  if (exitCode === 0) return null;
  if (exitCode === 127 || /not found/i.test(stderr))
    return `${tool} is not installed on this server.`;
  if (/permission denied/i.test(stderr) || /password is required/i.test(stderr))
    return `Not allowed: your SSH user cannot run ${tool} (it needs root or sudo without a password).`;
  if (/not been booted with systemd|System has not been booted/i.test(stderr))
    return 'This server does not use systemd.';
  return stderr.trim().split('\n')[0] || `${tool} failed (exit code ${exitCode}).`;
}
