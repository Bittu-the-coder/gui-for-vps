import { create } from 'zustand';

/** Which full-screen/popup layer is open. Opening one closes the others (they are all "modal-ish"). */
interface OverlayState {
  spotlight: boolean;
  overview: boolean;
  controlCenter: boolean;
  /** The Change master password dialog (opened from several places). */
  passwordDialog: boolean;
  setPasswordDialog: (open: boolean) => void;
  setSpotlight: (open: boolean) => void;
  setOverview: (open: boolean) => void;
  setControlCenter: (open: boolean) => void;
  closeAll: () => void;
}

const none = { spotlight: false, overview: false, controlCenter: false };

export const useOverlays = create<OverlayState>((set) => ({
  ...none,
  passwordDialog: false,
  setPasswordDialog: (open) => set({ passwordDialog: open }),
  setSpotlight: (open) => set({ ...none, spotlight: open }),
  setOverview: (open) => set({ ...none, overview: open }),
  setControlCenter: (open) => set({ ...none, controlCenter: open }),
  closeAll: () => set(none),
}));
