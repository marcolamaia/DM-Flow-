import { describe, expect, it } from 'vitest';
import { SecretBox, hashToken, safeEqual } from '../common/crypto';

const KEY = 'a'.repeat(64);

describe('SecretBox', () => {
  it('round-trips a secret', () => {
    const box = new SecretBox(KEY);
    const secret = 'sandbox-token-abc123';
    expect(box.decrypt(box.encrypt(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time', () => {
    // A deterministic ciphertext would leak that two accounts share a token.
    const box = new SecretBox(KEY);
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('rejects a tampered payload instead of returning garbage', () => {
    const box = new SecretBox(KEY);
    const payload = box.encrypt('secret');
    const [version, iv, tag, data] = payload.split('.');
    const flipped = `${version}.${iv}.${tag}.${data!.slice(0, -2)}AA`;
    expect(() => box.decrypt(flipped)).toThrow();
  });

  it('rejects a payload encrypted with a different key', () => {
    const payload = new SecretBox(KEY).encrypt('secret');
    expect(() => new SecretBox('b'.repeat(64)).decrypt(payload)).toThrow();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new SecretBox('abc')).toThrow();
  });

  it('never embeds the plaintext in the stored value', () => {
    const box = new SecretBox(KEY);
    expect(box.encrypt('super-secret-token')).not.toContain('super-secret-token');
  });
});

describe('token hashing', () => {
  it('is stable and one-way', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toContain('abc');
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
