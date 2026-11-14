import { describe, expect, it } from 'vitest';
import { shortcutFor, type FocusContext, type KeyInfo } from './hotkeys';

const key = (k: string, mods: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const nowhere: FocusContext = { inTerminal: false, inEditor: false, inTextField: false };
const terminal: FocusContext = { ...nowhere, inTerminal: true };
const editor: FocusContext = { ...nowhere, inEditor: true };
const field: FocusContext = { ...nowhere, inTextField: true };

describe('Spotlight shortcut', () => {
  it('Ctrl+K and Cmd+K open it on the desktop and in normal windows', () => {
    expect(shortcutFor(key('k', { ctrlKey: true }), nowhere)).toBe('spotlight');
    expect(shortcutFor(key('K', { ctrlKey: true }), nowhere)).toBe('spotlight');
    expect(shortcutFor(key('k', { metaKey: true }), nowhere)).toBe('spotlight');
  });
  it('Ctrl+K is left to bash in the Terminal and to Monaco in the Editor', () => {
    expect(shortcutFor(key('k', { ctrlKey: true }), terminal)).toBeNull();
    expect(shortcutFor(key('k', { ctrlKey: true }), editor)).toBeNull();
  });
  it('Cmd+K still works there', () => {
    expect(shortcutFor(key('k', { metaKey: true }), terminal)).toBe('spotlight');
    expect(shortcutFor(key('k', { metaKey: true }), editor)).toBe('spotlight');
  });
  it('works while typing in a normal text field', () => {
    expect(shortcutFor(key('k', { ctrlKey: true }), field)).toBe('spotlight');
  });
  it('ignores K with other modifiers or none', () => {
    expect(shortcutFor(key('k'), nowhere)).toBeNull();
    expect(shortcutFor(key('k', { ctrlKey: true, shiftKey: true }), nowhere)).toBeNull();
    expect(shortcutFor(key('k', { ctrlKey: true, altKey: true }), nowhere)).toBeNull();
  });
});

describe('Mission Control shortcut', () => {
  it('Ctrl+Up opens it outside text fields, the Terminal and the Editor', () => {
    expect(shortcutFor(key('ArrowUp', { ctrlKey: true }), nowhere)).toBe('overview');
    expect(shortcutFor(key('ArrowUp', { ctrlKey: true }), terminal)).toBeNull();
    expect(shortcutFor(key('ArrowUp', { ctrlKey: true }), editor)).toBeNull();
    expect(shortcutFor(key('ArrowUp', { ctrlKey: true }), field)).toBeNull();
  });
  it('plain Up is just Up', () => {
    expect(shortcutFor(key('ArrowUp'), nowhere)).toBeNull();
  });
});
