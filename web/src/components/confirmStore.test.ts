import { beforeEach, describe, expect, it } from 'vitest';
import { answerConfirm, confirmDialog, useConfirm } from './confirmStore';

beforeEach(() => useConfirm.setState({ request: null }));

describe('confirmDialog', () => {
  it('resolves true when confirmed and false when cancelled', async () => {
    const yes = confirmDialog({ title: 'Delete?' });
    expect(useConfirm.getState().request?.title).toBe('Delete?');
    answerConfirm(true);
    expect(await yes).toBe(true);
    expect(useConfirm.getState().request).toBeNull();

    const no = confirmDialog({ title: 'Again?' });
    answerConfirm(false);
    expect(await no).toBe(false);
  });

  it('a newer question cancels the unanswered older one', async () => {
    const first = confirmDialog({ title: 'First' });
    const second = confirmDialog({ title: 'Second' });
    expect(await first).toBe(false);
    answerConfirm(true);
    expect(await second).toBe(true);
  });

  it('answering with nothing open does nothing', () => {
    expect(() => answerConfirm(true)).not.toThrow();
  });
});
