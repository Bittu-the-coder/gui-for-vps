import { LEVEL_EFFECTS, SKILL_LEVELS, type SkillLevel } from '@gfv/shared';
import { create } from 'zustand';
import { readJson, writeJson } from '../lib/storage';
import { useLearn } from './learnStore';

const KEY = 'gfv.skill.v1';

interface SkillState {
  level: SkillLevel;
  setLevel: (level: SkillLevel) => void;
}

const initial = (): SkillLevel => {
  const v = readJson(KEY);
  return SKILL_LEVELS.includes(v as SkillLevel) ? (v as SkillLevel) : 'beginner';
};

/**
 * Skill level: how much hand-holding the interface gives. It only affects what is shown by default (the Learn
 * panel, whether the explanation is open); it never skips a confirmation or any part of the Safety Net.
 */
export const useSkill = create<SkillState>((set) => ({
  level: initial(),
  setLevel: (level) => {
    writeJson(KEY, level);
    set({ level });
    // Moving to a level that wants the Learn panel closed (or open) applies it once; you can still toggle it.
    const open = LEVEL_EFFECTS[level].learnPanelOpen;
    if (useLearn.getState().open !== open) useLearn.getState().toggle();
  },
}));
