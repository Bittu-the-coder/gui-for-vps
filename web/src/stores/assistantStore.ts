import { create } from 'zustand';
import { api } from '../lib/api';

/** Whether the assistant is turned on (so other screens can offer "Explain this"), and text waiting to be previewed. */
interface AssistantState {
  enabled: boolean;
  refresh: () => Promise<void>;
  prefill: { kind: 'ask' | 'explain'; text: string } | null;
  setPrefill: (p: AssistantState['prefill']) => void;
}

export const useAssistant = create<AssistantState>((set) => ({
  enabled: false,
  refresh: async () => {
    try {
      set({ enabled: (await api.aiSettings()).enabled });
    } catch {
      set({ enabled: false });
    }
  },
  prefill: null,
  setPrefill: (prefill) => set({ prefill }),
}));
