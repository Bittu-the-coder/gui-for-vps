import { typeIntoTerminal } from '../apps/terminal/terminalBus';

/** One shell command, with a "Try it yourself" button that types it into a terminal (without running it). */
export function CommandLine({
  command,
  serverId,
  onTried,
}: {
  command: string;
  serverId: string;
  onTried?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded bg-code px-2 py-1 text-xs text-code-foreground">
        $ {command}
      </code>
      <button
        title="Type this into a terminal without running it"
        className="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
        onClick={() => {
          typeIntoTerminal(serverId, command);
          onTried?.();
        }}
      >
        Try it yourself
      </button>
    </div>
  );
}
