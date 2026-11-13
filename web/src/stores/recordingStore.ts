import type { RecordingState } from '@gfv/shared';
import { create } from 'zustand';
import { api } from '../lib/api';

interface RecordingStore {
  active: RecordingState['active'];
  /** The recipe that was just finished: the Recipes app opens it, then clears this. */
  justStopped: string | null;
  clearJustStopped: () => void;
  refresh: () => Promise<void>;
  start: (serverId: string) => Promise<void>;
  /** Returns the id of the recipe that was just recorded. */
  stop: () => Promise<string | null>;
}

/** The recorder lives on the server (it survives a reload); this just mirrors it. */
export const useRecording = create<RecordingStore>((set, get) => ({
  active: null,
  justStopped: null,
  clearJustStopped: () => set({ justStopped: null }),
  refresh: async () => {
    try {
      set({ active: (await api.recording()).active });
    } catch {
      /* keep what we had */
    }
  },
  start: async (serverId) => {
    await api.startRecording(serverId);
    await get().refresh();
  },
  stop: async () => {
    try {
      const { recipeId } = await api.stopRecording();
      set({ active: null, justStopped: recipeId });
      return recipeId;
    } catch {
      await get().refresh();
      return null;
    }
  },
}));
