import { describe, expect, it } from 'vitest';
import { actionById } from '../actions/index.js';
import { LESSONS } from './content.js';
import {
  doStepDone,
  lessonPercent,
  shuffledQuiz,
  lessonsByLevel,
  LEVEL_EFFECTS,
  SKILL_LEVELS,
  type LessonStep,
} from './engine.js';

describe('the lesson catalog (guards the content itself)', () => {
  it('has unique lesson ids, real levels, and enough steps', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(SKILL_LEVELS, l.id).toContain(l.level);
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.minutes, l.id).toBeGreaterThan(0);
    }
  });
  it('every level has at least one lesson', () => {
    const g = lessonsByLevel(LESSONS);
    for (const lv of SKILL_LEVELS) expect(g[lv].length, lv).toBeGreaterThan(0);
  });
  it('every "do" step uses an action that exists, and runForMe only for parameter-free safe ones', () => {
    for (const l of LESSONS)
      for (const s of l.steps) {
        if (s.type !== 'do') continue;
        const a = actionById(s.actionId);
        expect(a, `${l.id}: ${s.actionId}`).toBeDefined();
        if (s.runForMe) expect(a!.risk, `${l.id}: runForMe must be safe`).toBe('safe');
      }
  });
  it('every quiz has one valid answer among distinct options, and an explanation', () => {
    for (const l of LESSONS)
      for (const s of l.steps) {
        if (s.type !== 'quiz') continue;
        expect(s.options.length, `${l.id}: ${s.title}`).toBeGreaterThanOrEqual(2);
        expect(new Set(s.options).size, `${l.id}: duplicate options`).toBe(s.options.length);
        expect(
          Number.isInteger(s.answer) && s.answer >= 0 && s.answer < s.options.length,
          `${l.id}: ${s.title}`,
        ).toBe(true);
        expect(s.explain.length, `${l.id}: ${s.title}`).toBeGreaterThan(10);
      }
  });
  it('the shuffle keeps the right answer pointing at the right text, is stable, and moves it around', () => {
    const quizzes = LESSONS.flatMap((l) => l.steps).filter(
      (s): s is Extract<LessonStep, { type: 'quiz' }> => s.type === 'quiz',
    );
    expect(quizzes.length).toBeGreaterThan(5);
    let moved = 0;
    for (const q of quizzes) {
      const a = shuffledQuiz(q);
      expect(a.options).toHaveLength(q.options.length);
      expect([...a.options].sort()).toEqual([...q.options].sort());
      expect(a.options[a.answer]).toBe(q.options[q.answer]);
      expect(shuffledQuiz(q)).toEqual(a); // same every time
      if (a.answer !== q.answer) moved++;
    }
    expect(moved).toBeGreaterThan(quizzes.length / 3); // the correct answer is not (nearly) always in the same place
  });
});

describe('doStepDone', () => {
  const step = {
    type: 'do',
    title: 't',
    body: 'b',
    actionId: 'files.mkdir',
    paramContains: 'gfv-lesson',
  } as const;
  const e = (over = {}) => ({
    actionId: 'files.mkdir',
    exitCode: 0,
    startedAt: 2000,
    params: { path: '/home/u/gfv-lesson' },
    ...over,
  });
  it('is done by a matching, successful, recent run', () => {
    expect(doStepDone(step, [e()], 1000)).toBe(true);
  });
  it('ignores failures, other actions, older runs and other params', () => {
    expect(doStepDone(step, [e({ exitCode: 1 })], 1000)).toBe(false);
    expect(doStepDone(step, [e({ actionId: 'files.rename' })], 1000)).toBe(false);
    expect(doStepDone(step, [e({ startedAt: 500 })], 1000)).toBe(false); // from before the lesson started
    expect(doStepDone(step, [e({ params: { path: '/tmp/other' } })], 1000)).toBe(false);
  });
  it('without paramContains any params count', () => {
    expect(
      doStepDone({ ...step, paramContains: undefined }, [e({ params: { path: '/x' } })], 1000),
    ).toBe(true);
  });
});

describe('progress and levels', () => {
  const lesson = LESSONS[0]!;
  it('percent follows the step, 100 when completed', () => {
    expect(lessonPercent(lesson, undefined)).toBe(0);
    expect(lessonPercent(lesson, { startedAt: 1, step: 0 })).toBe(0);
    expect(lessonPercent(lesson, { startedAt: 1, step: 2 })).toBe(50);
    expect(lessonPercent(lesson, { startedAt: 1, step: 1, completedAt: 5 })).toBe(100);
  });
  it('levels only remove hand-holding, in order', () => {
    expect(LEVEL_EFFECTS.beginner).toEqual({ learnPanelOpen: true, explainOpen: true });
    expect(LEVEL_EFFECTS.expert).toEqual({ learnPanelOpen: false, explainOpen: false });
  });
});
