import { useEffect, useState } from 'react';

export function NotesApp() {
  return (
    <textarea
      className="h-full w-full resize-none bg-transparent p-3 text-sm outline-none"
      placeholder="Type something…"
    />
  );
}

export function ClockApp() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid h-full place-items-center text-3xl tabular-nums">
      {now.toLocaleTimeString()}
    </div>
  );
}

export function HelloApp({ windowId }: { windowId: string }) {
  return (
    <div className="p-4 text-sm">
      Hello from window <code>{windowId}</code> 👋
    </div>
  );
}
