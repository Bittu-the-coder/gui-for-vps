import { create } from 'zustand';

export interface RunRequest {
  serverId: string;
  actionId: string;
  params: unknown;
}

/** Any app asks for a run with `requestRun(...)`; the RunDialog (mounted once in the Desktop) shows it. */
interface RunState {
  request: RunRequest | null;
  close: () => void;
}

export const useRunDialog = create<RunState>((set) => ({
  request: null,
  close: () => set({ request: null }),
}));

export const requestRun = (req: RunRequest) => useRunDialog.setState({ request: req });
