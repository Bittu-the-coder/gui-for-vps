import { siteSchema } from '@gfv/shared';
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

/**
 * Add a site (a domain pointing at your app) or get an HTTPS certificate for one. Both only COLLECT values: the
 * Run dialog then shows the exact commands, and the server checks the values again.
 */
export function SiteDialog({
  serverId,
  httpsFor,
  onClose,
  onDone,
}: {
  serverId: string;
  /** Set to ask for an HTTPS certificate for this domain instead of adding a site. */
  httpsFor?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<'proxy' | 'static'>('proxy');
  const [domain, setDomain] = useState(httpsFor ?? '');
  const [port, setPort] = useState('3000');
  const [root, setRoot] = useState('/var/www/html');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');

  const submit = () => {
    if (httpsFor) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return setProblem(
          'Enter a valid email address (Let’s Encrypt sends expiry warnings to it).',
        );
      requestRun({
        serverId,
        actionId: 'domains.https',
        params: { domain: httpsFor, email },
        onDone,
      });
      return onClose();
    }
    const spec =
      kind === 'proxy'
        ? { kind, domain: domain.trim().toLowerCase(), port: Number(port) }
        : { kind, domain: domain.trim().toLowerCase(), root: root.trim() };
    const parsed = siteSchema.safeParse(spec);
    if (!parsed.success)
      return setProblem(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('. '),
      );
    requestRun({ serverId, actionId: 'nginx.site.create', params: parsed.data, onDone });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{httpsFor ? `HTTPS for ${httpsFor}` : 'Add a site'}</DialogTitle>
          <DialogDescription>
            {httpsFor
              ? 'Gets a free certificate from Let’s Encrypt. The domain must already point at this server (DNS) and ports 80 and 443 must be open. Requires certbot.'
              : 'Point a domain at an app running on this server, or at a folder of static files. Point the domain’s DNS (an A record) at this server’s IP address first.'}
          </DialogDescription>
        </DialogHeader>

        {httpsFor ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="le-email">Email for Let’s Encrypt</Label>
            <Input
              id="le-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-footnote text-muted-foreground">
              Continuing asks certbot to accept Let’s Encrypt’s Terms of Service on your behalf: the
              preview shows the exact command.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                requestRun({ serverId, actionId: 'domains.install-certbot', params: {} })
              }
            >
              Install certbot first…
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="site-domain">Domain</Label>
              <Input
                id="site-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
              />
            </div>
            <div role="radiogroup" aria-label="What the site serves" className="flex gap-1">
              <Button
                role="radio"
                aria-checked={kind === 'proxy'}
                size="sm"
                variant={kind === 'proxy' ? 'default' : 'outline'}
                onClick={() => setKind('proxy')}
              >
                An app (proxy to a port)
              </Button>
              <Button
                role="radio"
                aria-checked={kind === 'static'}
                size="sm"
                variant={kind === 'static' ? 'default' : 'outline'}
                onClick={() => setKind('static')}
              >
                A folder of files
              </Button>
            </div>
            {kind === 'proxy' ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="site-port">Port your app listens on</Label>
                <Input
                  id="site-port"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor="site-root">Folder</Label>
                <Input id="site-root" value={root} onChange={(e) => setRoot(e.target.value)} />
              </div>
            )}
          </div>
        )}

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
