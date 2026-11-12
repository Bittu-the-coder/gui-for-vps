import { beforeEach, describe, expect, it } from 'vitest';
import { useDesktop } from './windowStore';

const app = { appId: 'notes', title: 'Notes', w: 400, h: 300 };
const s = () => useDesktop.getState();

beforeEach(() => useDesktop.setState({ windows: {}, focusedId: null, nextZ: 1 }));

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
});
