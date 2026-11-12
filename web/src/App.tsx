import { useEffect, useState } from 'react';
import { HealthSchema } from '@gfv/shared';

export function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setStatus(HealthSchema.safeParse(d).success ? 'ok' : 'error'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center">
      <p className="text-sm">
        GFV · API: {status === 'ok' ? '✅ OK' : status === 'loading' ? '…' : '❌ unreachable'}
      </p>
    </main>
  );
}
