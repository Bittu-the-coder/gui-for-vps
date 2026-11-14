import { beforeEach, describe, expect, it } from 'vitest';
import { consumeFresh, fitToWorkspace, tryClose, useDesktop } from './windowStore';

const app = { appId: 'notes', title: 'Notes', w: 400, h: 300 };
const s = () => useDesktop.getState();

beforeEach(() => useDesktop.setState({ windows: {}, focusedId: null, nextZ: 1, closing: {} }));

describe('windowStore', () => {
  it('opens a window and focuses it', () => {
    const id = s().open(app);
    expect(s().focusedId).toBe(id);
    expect(s().windows[id]?.title).toBe('Notes');
  });

  it('focus raises z-order above other windows', () => {
    const a = s().open(app);
    const b = s().open(app);
    s().focus(a);
    expect(s().windows[a]!.z).toBeGreaterThan(s().windows[b]!.z);
    expect(s().focusedId).toBe(a);
  });

  it('minimize moves focus to the next visible window', () => {
    const a = s().open(app);
    const b = s().open(app);
    s().minimize(b);
    expect(s().windows[b]!.minimized).toBe(true);
    expect(s().focusedId).toBe(a);
  });

  it('focusing a minimized window restores it', () => {
    const a = s().open(app);
    s().minimize(a);
    s().focus(a);
    expect(s().windows[a]!.minimized).toBe(false);
  });

  it('maximize then restore returns the original rectangle', () => {
    const id = s().open(app);
    s().move(id, 150, 90);
    const before = { ...s().windows[id]! };
    s().toggleMaximize(id);
    expect(s().windows[id]!.maximized).toBe(true);
    s().toggleMaximize(id);
    const after = s().windows[id]!;
    expect([after.x, after.y, after.w, after.h]).toEqual([before.x, before.y, before.w, before.h]);
    expect(after.maximized).toBe(false);
  });

  it('ignores move while maximized', () => {
    const id = s().open(app);
    s().toggleMaximize(id);
    s().move(id, 999, 999);
    expect(s().windows[id]!.x).not.toBe(999);
  });

  it('close removes the window and refocuses', () => {
    const a = s().open(app);
    const b = s().open(app);
    s().close(b);
    expect(s().windows[b]).toBeUndefined();
    expect(s().focusedId).toBe(a);
  });

  it('requestClose only marks the window; close removes it and clears the mark', () => {
    const id = s().open(app);
    s().requestClose(id);
    expect(s().closing[id]).toBe(true);
    expect(s().windows[id]).toBeDefined(); // still mounted while the animation plays
    s().close(id);
    expect(s().windows[id]).toBeUndefined();
    expect(s().closing[id]).toBeUndefined();
  });

  it('tryClose goes through requestClose (animated close)', () => {
    const id = s().open(app);
    tryClose(id);
    expect(s().closing[id]).toBe(true);
  });

  it('only a newly opened window is "fresh" (once)', () => {
    const id = s().open(app);
    expect(consumeFresh(id)).toBe(true);
    expect(consumeFresh(id)).toBe(false);
    expect(consumeFresh('win-from-a-reload')).toBe(false);
  });
});

describe('fitToWorkspace', () => {
  it('shrinks a window that would stick out of the workspace, but not below a usable size', () => {
    const area = { w: 1080, h: 850 };
    expect(fitToWorkspace(80, 60, 1000, 560, area)).toEqual({ w: 976, h: 560 });
    expect(fitToWorkspace(80, 60, 700, 400, area)).toEqual({ w: 700, h: 400 });
    expect(fitToWorkspace(80, 60, 900, 900, { w: 500, h: 400 })).toEqual({ w: 420, h: 300 });
    expect(fitToWorkspace(80, 60, 900, 500, null)).toEqual({ w: 900, h: 500 });
  });
});
