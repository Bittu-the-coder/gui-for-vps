import type { HistoryEntry } from '../runner.js';

/** Guided lessons: short, real, and checked against what you actually did on a server. */

export type SkillLevel = 'beginner' | 'intermediate' | 'expert';
export const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'expert'];

export type LessonStep =
  | { type: 'read'; title: string; body: string }
  | {
      type: 'quiz';
      title: string;
      question: string;
      options: string[];
      /** Index of the correct option. */
      answer: number;
      /** Shown after the right answer (and as a hint after a wrong one). */
      explain: string;
    }
  | {
      type: 'do';
      title: string;
      body: string;
      /** Done when this action finished successfully on the server, after the lesson was started. */
      actionId: string;
      /** If set, the action's params must contain this text (for example the folder name to create). */
      paramContains?: string;
      /** Which app to open to do it. */
      app?: string;
      /** Lets the lesson run the action for you (safe, parameter-free ones). */
      runForMe?: { params: unknown; label: string };
    };

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  level: SkillLevel;
  minutes: number;
  steps: LessonStep[];
}

/** Did a history entry finish this "do" step? Pure, so it is easy to test. */
export function doStepDone(
  step: Extract<LessonStep, { type: 'do' }>,
  entries: Pick<HistoryEntry, 'actionId' | 'exitCode' | 'startedAt' | 'params'>[],
  since: number,
): boolean {
  return entries.some(
    (e) =>
      e.actionId === step.actionId &&
      e.exitCode === 0 &&
      e.startedAt >= since &&
      (!step.paramContains || JSON.stringify(e.params ?? '').includes(step.paramContains)),
  );
}

/** Saved progress for one lesson. */
export interface LessonProgress {
  startedAt: number;
  /** Index of the step being worked on. */
  step: number;
  completedAt?: number;
}

export function lessonPercent(lesson: Lesson, p: LessonProgress | undefined): number {
  if (!p) return 0;
  if (p.completedAt) return 100;
  return Math.round((Math.min(p.step, lesson.steps.length) / lesson.steps.length) * 100);
}

/** Lessons grouped by level, in teaching order. */
export function lessonsByLevel(lessons: Lesson[]): Record<SkillLevel, Lesson[]> {
  return {
    beginner: lessons.filter((l) => l.level === 'beginner'),
    intermediate: lessons.filter((l) => l.level === 'intermediate'),
    expert: lessons.filter((l) => l.level === 'expert'),
  };
}

/**
 * What a skill level changes. It only ever removes hand-holding; it never skips a safety check:
 * confirmations for risky actions and the server-side Safety Net are the same at every level.
 */
export const LEVEL_EFFECTS: Record<SkillLevel, { learnPanelOpen: boolean; explainOpen: boolean }> =
  {
    beginner: { learnPanelOpen: true, explainOpen: true },
    intermediate: { learnPanelOpen: true, explainOpen: false },
    expert: { learnPanelOpen: false, explainOpen: false },
  };

/** A small deterministic generator (mulberry32), so a quiz shows the same order every time you open it. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/**
 * The options of a quiz in a fixed but scrambled order, so the right answer is not always first.
 * `answer` is the index of the correct option in the SHUFFLED list.
 */
export function shuffledQuiz(step: Extract<LessonStep, { type: 'quiz' }>): {
  options: string[];
  answer: number;
} {
  const order = step.options.map((_, i) => i);
  const rand = rng(hash(step.question));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { options: order.map((i) => step.options[i]!), answer: order.indexOf(step.answer) };
}
