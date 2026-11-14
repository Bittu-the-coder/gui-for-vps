import { describe, expect, it } from 'vitest';
import { describeStep } from './stepView';

describe('describeStep', () => {
  it('shows a placeholder where the parameter goes', () => {
    const info = describeStep('files.mkdir', { path: '/var/www/{{site}}/logs' });
    expect(info?.title).toBe('Create a folder');
    expect(info?.commands.join('\n')).toContain('/var/www/{{site}}/logs');
    expect(info?.commands.join('\n')).not.toContain('__GFVPARAM');
  });
  it('works for steps without parameters', () => {
    expect(describeStep('files.mkdir', { path: '/tmp/a' })?.commands[0]).toContain('/tmp/a');
  });
  it('is null for an unknown action', () => {
    expect(describeStep('nope.nothing', {})).toBeNull();
  });
});
