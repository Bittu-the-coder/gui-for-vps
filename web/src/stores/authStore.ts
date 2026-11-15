import { create } from 'zustand';
import { api } from '../lib/api';

type Status = Awaited<ReturnType<typeof api.authStatus>>;

/** Who is signed in. In local mode (`hosted: false`) there are no accounts and everything behaves as before. */
interface AuthState {
  status: Status | null;
  accountOpen: boolean;
  load: () => Promise<Status>;
  logout: () => Promise<void>;
  setAccountOpen: (open: boolean) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: null,
  accountOpen: false,
  load: async () => {
    const status = await api.authStatus();
    set({ status });
    return status;
  },
  logout: async () => {
    await api.authLogout().catch(() => {});
    set({ accountOpen: false });
    await get().load();
  },
  setAccountOpen: (accountOpen) => set({ accountOpen }),
}));

export const useIsAdmin = () =>
  useAuth((s) => !s.status?.hosted || s.status.user?.role === 'admin');
