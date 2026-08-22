import { describe, expect, it } from 'vitest';
import { isBlockedAddress, safeFetch } from '../engine/safe-fetch';

describe('SSRF guard', () => {
  it('blocks loopback, private and link-local ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it('blocks the cloud metadata address specifically', () => {
    // The single most valuable target for an SSRF in a hosted product.
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('blocks IPv6 loopback and unique-local', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('fd00::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 that smuggles a private address', () => {
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
  });

  it('allows ordinary public addresses', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('rejects anything that is not an IP at all', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });

  it('refuses a non-https scheme', async () => {
    await expect(
      safeFetch('http://example.com', { method: 'GET', headers: {}, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('refuses a literal private target before making any request', async () => {
    await expect(
      safeFetch('https://127.0.0.1/admin', { method: 'GET', headers: {}, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    await expect(
      safeFetch('https://169.254.169.254/latest/meta-data/', {
        method: 'GET',
        headers: {},
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
});
