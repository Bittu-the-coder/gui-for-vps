import type { LessonProgress } from '@gfv/shared';
import { z } from 'zod';
import { create } from 'zustand';
import { readJson, writeJson } from '../lib/storage';

const KEY = 'gfv.lessons.v1';
const Schema = z.record(
  z.string(),
  z.object({
    startedAt: z.number(),
    step: z.number().int().min(0),
    completedAt: z.number().optional(),
  }),
);

interface LessonState {
  progress: Record<string, LessonProgress>;
  start: (id: string) => void;
  setStep: (id: string, step: number) => void;
  complete: (id: string) => void;
  reset: (id: string) => void;
}

const load = (): Record<string, LessonProgress> => {
  const p = Schema.safeParse(readJson(KEY));
  return p.success ? p.data : {};
};
const save = (progress: Record<string, LessonProgress>) => writeJson(KEY, progress);

/** Lesson progress lives in this browser (localStorage); lessons themselves are in the shared package. */
export const useLessons = create<LessonState>((set, get) => {
  const put = (id: string, p: LessonProgress | undefined) => {
    const next = { ...get().progress };
    if (p) next[id] = p;
    else delete next[id];
    save(next);
    set({ progress: next });
  };
  return {
    progress: load(),
    start: (id) => get().progress[id] || put(id, { startedAt: Date.now(), step: 0 }),
    setStep: (id, step) => {
      const p = get().progress[id];
      if (p) put(id, { ...p, step });
    },
    complete: (id) => {
      const p = get().progress[id];
      if (p) put(id, { ...p, completedAt: Date.now() });
    },
    reset: (id) => put(id, undefined),
  };
});
