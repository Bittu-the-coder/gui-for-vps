import { beforeEach, describe, expect, it } from 'vitest';
import { notifyChanges } from './serverStore';
import { useToasts } from './toastStore';

const servers = [{ id: 'a', name: 'vps-a' }];
const titles = () => useToasts.getState().toasts.map((t) => `${t.kind}:${t.title}`);
beforeEach(() => useToasts.getState().clear());

describe('notifyChanges (connection toasts)', () => {
  it('says nothing for the first status of a server', () => {
    notifyChanges({}, { a: 'connected' }, servers);
    expect(titles()).toEqual([]);
  });
  it('reports an unexpected drop as an error', () => {
    notifyChanges({ a: 'connected' }, { a: 'error' }, servers);
    expect(titles()).toEqual(['error:Lost connection to vps-a']);
  });
  it('reports a (re)connection', () => {
    notifyChanges({ a: 'connecting' }, { a: 'connected' }, servers);
    expect(titles()).toEqual(['success:vps-a connected']);
  });
  it('stays quiet when the user disconnects on purpose, or nothing changed', () => {
    notifyChanges({ a: 'connected' }, { a: 'disconnected' }, servers);
    notifyChanges({ a: 'connected' }, { a: 'connected' }, servers);
    expect(titles()).toEqual([]);
  });
});
