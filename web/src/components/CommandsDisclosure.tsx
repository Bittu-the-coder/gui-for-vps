import { actionById, previewAction } from '@gfv/shared';
import { CommandLine } from './CommandLine';

/** "Commands this view runs": Learn Mode for views that poll quietly instead of opening a run dialog. */
export function CommandsDisclosure({
  serverId,
  actions,
}: {
  serverId: string;
  actions: { id: string; params?: object }[];
}) {
  return (
    <details className="border-t border-border px-2 py-1 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Commands this view runs</summary>
      <div className="mt-1 flex flex-col gap-2 pb-1">
        {actions.map(({ id, params }) => {
          const p = previewAction(id, params ?? {});
          if (!p.ok) return null;
          return (
            <div key={id} className="flex flex-col gap-1">
              <p>{actionById(id)?.explain}</p>
              {p.preview.commands.map((c) => (
                <CommandLine key={c} command={c} serverId={serverId} />
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}
