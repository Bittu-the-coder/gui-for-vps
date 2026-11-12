import type { HistoryEntry } from '@gfv/shared';
import { create } from 'zustand';
import { api } from '../lib/api';
import { readJson, writeJson } from '../lib/storage';

const KEY = 'gfv.learn.v1';

interface LearnState {
  /** Learn panel visible. On by default for new users. */
  open: boolean;
  entries: HistoryEntry[];
  learned: string[];
  toggle: () => void;
  refresh: () => Promise<void>;
}

export const useLearn = create<LearnState>((set, get) => ({
  open: readJson(KEY) !== false,
  entries: [],
  learned: [],
  toggle: () => {
    writeJson(KEY, !get().open);
    set({ open: !get().open });
  },
  refresh: async () => {
    try {
      const h = await api.history();
      set({ entries: h.entries, learned: h.learned });
    } catch {
      /* the panel just keeps showing what it had */
    }
  },
}));
