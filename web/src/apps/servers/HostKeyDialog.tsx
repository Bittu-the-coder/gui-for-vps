import type { ConnectResult, Server } from '@gfv/shared';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

export type HostKeyPrompt = {
  server: Server;
  result: Extract<ConnectResult, { status: 'host_key_unknown' | 'host_key_changed' }>;
};

/**
 * The most security-sensitive dialog in the app. A new key must be shown for the
 * user to verify; a CHANGED key is a loud warning and never accepted by default.
 */
export function HostKeyDialog({
  prompt,
  onTrust,
  onCancel,
}: {
  prompt: HostKeyPrompt | null;
  onTrust: (p: HostKeyPrompt) => void;
  onCancel: () => void;
}) {
  const changed = prompt?.result.status === 'host_key_changed';
  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        {prompt && (
          <>
            <DialogHeader>
              <DialogTitle className={changed ? 'text-destructive' : undefined}>
                {changed ? '⚠️ Host key has CHANGED' : 'New server — verify its identity'}
              </DialogTitle>
              <DialogDescription>
                {changed ? (
                  <>
                    The key presented by <b>{prompt.server.host}</b> is different from the one you
                    trusted before. Someone may be intercepting your connection — or the server was
                    reinstalled. Only continue if you know why it changed.
                  </>
                ) : (
                  <>
                    This is the first time GFV connects to <b>{prompt.server.host}</b>. Check that
                    the fingerprint below matches what your hosting provider shows. GFV will
                    remember it and warn you if it ever changes.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <dl className="flex flex-col gap-2 text-xs">
              {prompt.result.status === 'host_key_changed' && (
                <div>
                  <dt className="text-muted-foreground">Previously trusted</dt>
                  <dd className="break-all rounded bg-muted p-2 font-mono">
                    {prompt.result.expected}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">
                  {changed ? 'Presented now' : 'Fingerprint'} ({prompt.result.keyType})
                </dt>
                <dd className="break-all rounded bg-muted p-2 font-mono">
                  {prompt.result.fingerprint}
                </dd>
              </div>
            </dl>

            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant={changed ? 'destructive' : 'default'} onClick={() => onTrust(prompt)}>
                {changed ? 'I understand — replace key' : 'Trust and connect'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
