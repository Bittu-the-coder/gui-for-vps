import { describe, expect, it } from 'vitest';
import { friendlyConnectError } from './connect.js';

describe('friendlyConnectError', () => {
  it('explains a timeout in terms of what to check', () => {
    const m = friendlyConnectError('Timed out while waiting for handshake', '203.0.113.7', 22);
    expect(m).toContain('203.0.113.7:22');
    expect(m).toContain('security group');
    expect(m).not.toContain('handshake');
  });
  it('explains refused, unknown host and no route', () => {
    expect(friendlyConnectError('connect ECONNREFUSED 10.0.0.5:2222', '10.0.0.5', 2222)).toContain(
      'refused the connection',
    );
    expect(
      friendlyConnectError(
        'getaddrinfo ENOTFOUND my-server.exmaple.com',
        'my-server.exmaple.com',
        22,
      ),
    ).toContain('Check the address for typos');
    expect(friendlyConnectError('connect EHOSTUNREACH 10.9.9.9:22', '10.9.9.9', 22)).toContain(
      'no route',
    );
  });
  it('keeps messages it does not recognise exactly as they were', () => {
    expect(friendlyConnectError('Something odd happened', 'h', 22)).toBe('Something odd happened');
  });
});
