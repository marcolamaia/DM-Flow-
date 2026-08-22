import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Version prefix so a future key rotation can identify what encrypted a value. */
const VERSION = 'v1';

/**
 * Channel tokens and integration secrets are the crown jewels of this product:
 * they authorise sending messages as somebody else's business. They are never
 * stored, logged or returned in plaintext.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
      '.',
    );
  }

  decrypt(payload: string): string {
    const [version, ivPart, tagPart, dataPart] = payload.split('.');
    if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
      throw new Error('Malformed encrypted payload');
    }
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Safe to log: identifies a value without revealing it. */
  fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
  }
}

/** Opaque tokens (sessions, API keys, invitations) are stored hashed, never raw. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
