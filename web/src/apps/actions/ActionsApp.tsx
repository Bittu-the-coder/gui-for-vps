import type { ActionInfo } from '@gfv/shared';
import { useEffect, useState } from 'react';
import { RiskBadge } from '../../components/RiskBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useDesktop } from '../../desktop/windowStore';
import { api } from '../../lib/api';
import { requestRun } from '../../runner/runStore';

/**
 * Temporary launcher for the sample actions, so the Command Runner has a UI in M4.
 * It is replaced by the real apps (Files, Services, Dev Hub...) in M5-M7.
 */
export function ActionsApp({ windowId }: { windowId: string }) {
  const serverId = useDesktop((s) => s.windows[windowId]?.serverId);
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .actions()
      .then(setActions)
      .catch(() => {});
  }, []);

  if (!serverId) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
        Pick a server in the menu bar, then open a new Actions window.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {actions.map((a) => (
        <div key={a.id} className="rounded border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{a.title}</span>
            <RiskBadge risk={a.risk} />
          </div>
          <p className="my-1 text-xs text-muted-foreground">{a.explain}</p>
          <div className="mt-2 flex items-end gap-2">
            {a.fields.map((f) => (
              <label key={f.name} className="flex flex-1 flex-col gap-1 text-xs">
                {f.label}
                <Input
                  placeholder={f.placeholder}
                  value={values[`${a.id}.${f.name}`] ?? ''}
                  onChange={(e) => setValues({ ...values, [`${a.id}.${f.name}`]: e.target.value })}
                />
              </label>
            ))}
            <Button
              size="sm"
              onClick={() =>
                requestRun({
                  serverId,
                  actionId: a.id,
                  params: Object.fromEntries(
                    a.fields.map((f) => [f.name, values[`${a.id}.${f.name}`] ?? '']),
                  ),
                })
              }
            >
              Run…
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
