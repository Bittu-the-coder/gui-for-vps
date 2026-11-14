import { describe, expect, it } from 'vitest';
import type { JobSnapshot } from '@gfv/shared';
import { jobAnnouncements } from './jobStore';

const job = (
  status: JobSnapshot['status'],
  targets: { id: string; status: JobSnapshot['targets'][number]['status'] }[],
): JobSnapshot => ({
  id: 'j',
  kind: 'replay',
  name: 'Replay: Web stack',
  status,
  startedAt: 0,
  finishedAt: null,
  targets: targets.map((t) => ({
    serverId: t.id,
    status: t.status,
    current: 0,
    steps: [
      { actionId: 'a', title: 'Install nginx', status: t.status === 'paused' ? 'failed' : 'ok' },
    ],
  })),
});
const name = (id: string) => `server-${id}`;

describe('jobAnnouncements', () => {
  it('announces a target that just paused, once', () => {
    const before = job('running', [{ id: 'a', status: 'running' }]);
    const after = job('running', [{ id: 'a', status: 'paused' }]);
    const first = jobAnnouncements(before, after, name);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'error', title: 'server-a needs a decision' });
    expect(first[0]!.body).toContain('Install nginx');
    expect(jobAnnouncements(after, after, name)).toEqual([]); // still paused: no repeat
  });
  it('announces the end of a job with how many servers completed', () => {
    const before = job('running', [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'done' },
    ]);
    const done = jobAnnouncements(
      before,
      job('done', [
        { id: 'a', status: 'done' },
        { id: 'b', status: 'done' },
      ]),
      name,
    );
    expect(done[0]).toMatchObject({
      kind: 'success',
      title: 'Replay: Web stack finished',
      body: '2 of 2 servers completed.',
    });
    const failed = jobAnnouncements(
      before,
      job('failed', [
        { id: 'a', status: 'failed' },
        { id: 'b', status: 'done' },
      ]),
      name,
    );
    expect(failed[0]).toMatchObject({ kind: 'error' });
    expect(failed[0]!.body).toBe('1 of 2 servers completed.');
  });
  it('says nothing for a job that was already finished when first seen', () => {
    expect(jobAnnouncements(undefined, job('done', [{ id: 'a', status: 'done' }]), name)).toEqual(
      [],
    );
  });
});
