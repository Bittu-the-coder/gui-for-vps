import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn (class merging)', () => {
  it('keeps a text colour next to our custom font sizes', () => {
    // Regression: `text-footnote` after `text-primary-foreground` used to delete the white text.
    expect(cn('text-primary-foreground', 'text-footnote')).toBe(
      'text-primary-foreground text-footnote',
    );
    expect(cn('text-body text-danger')).toBe('text-body text-danger');
  });
  it('still lets the last class win when two really conflict', () => {
    expect(cn('text-body', 'text-callout')).toBe('text-callout');
    expect(cn('text-danger', 'text-success')).toBe('text-success');
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
