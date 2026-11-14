import type { ConnStatus, Server, VaultStatus } from '@gfv/shared';
import { create } from 'zustand';
import { api } from '../lib/api';
import { readJson, writeJson } from '../lib/storage';
import { startStatusSocket } from '../lib/ws';
import { toast } from './toastStore';

const ACTIVE_KEY = 'gfv.activeServer.v1';

interface ServerState {
  vault: VaultStatus | null; // null = not loaded yet
  servers: Server[];
  statuses: Record<string, ConnStatus>;
  /** The live link to the GFV server (the status WebSocket) is up. */
  live: boolean;
  activeId: string | null;

  refreshVault: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  createVault: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshStatuses: () => Promise<void>;
  setActive: (id: string | null) => void;
}

let stopSocket: (() => void) | undefined;

/** Tell the user when a server they were connected to drops, or comes back (never for the first status). */
export function notifyChanges(
  prev: Record<string, ConnStatus>,
  next: Record<string, ConnStatus>,
  servers: { id: string; name: string }[],
): void {
  for (const [id, status] of Object.entries(next)) {
    const before = prev[id];
    if (!before || before === status) continue;
    const name = servers.find((s) => s.id === id)?.name ?? 'A server';
    if (before === 'connected' && status === 'error')
      toast({
        kind: 'error',
        title: `Lost connection to ${name}`,
        body: 'GFV will try to reconnect.',
      });
    else if (before !== 'connected' && status === 'connected')
      toast({ kind: 'success', title: `${name} connected` });
  }
}

export const useServers = create<ServerState>((set, get) => {
  /** Called whenever the vault becomes unlocked: load data and open the live socket. */
  const onUnlocked = async () => {
    await Promise.all([get().refreshServers(), get().refreshStatuses()]);
    stopSocket?.();
    stopSocket = startStatusSocket(
      (statuses) => {
        notifyChanges(get().statuses, statuses, get().servers);
        set({ statuses });
      },
      (live) => set({ live }),
    );
  };
  const onLocked = () => {
    stopSocket?.();
    stopSocket = undefined;
    set({ servers: [], statuses: {} });
  };

  return {
    vault: null,
    servers: [],
    statuses: {},
    live: true,
    activeId: typeof readJson(ACTIVE_KEY) === 'string' ? (readJson(ACTIVE_KEY) as string) : null,

    refreshVault: async () => {
      const vault = await api.vault();
      set({ vault });
      if (vault.unlocked) await onUnlocked();
      else onLocked();
    },
    unlock: async (password) => {
      set({ vault: await api.unlock(password) });
      await onUnlocked();
    },
    createVault: async (password) => {
      set({ vault: await api.createVault(password) });
      await onUnlocked();
    },
    lock: async () => {
      set({ vault: await api.lock() });
      onLocked();
    },
    refreshServers: async () => {
      const servers = await api.servers();
      // Forget an active server that no longer exists.
      const { activeId } = get();
      const stillThere = activeId && servers.some((s) => s.id === activeId);
      set({ servers, activeId: stillThere ? activeId : (servers[0]?.id ?? null) });
    },
    refreshStatuses: async () => set({ statuses: await api.connections() }),
    setActive: (id) => {
      writeJson(ACTIVE_KEY, id);
      set({ activeId: id });
    },
  };
});
