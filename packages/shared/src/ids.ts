import { randomBytes } from 'node:crypto';

/**
 * UUID v7 — time-sortable, so primary keys cluster by creation time instead of
 * scattering across the index, and they are not enumerable like an auto-increment.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48-bit big-endian millisecond timestamp
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Prefixed, URL-safe token for invitations, API keys and reset links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Um endereço de e-mail reduzido ao que dá para reconhecer sem entregar o resto.
 *
 * `marcos@exemplo.com` vira `m****s@exemplo.com`.
 *
 * Serve para uma situação específica: avisar o dono de uma conta que pediram
 * para mover o e-mail dela para outro endereço. Ele precisa de informação
 * suficiente para reconhecer ("isso é meu e-mail novo, fui eu") ou estranhar
 * ("não conheço isso"), sem que a mensagem entregue de bandeja um endereço
 * válido para quem interceptar a caixa.
 *
 * O domínio fica inteiro de propósito: é ele que denuncia o golpe.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';

  const local = email.slice(0, at);
  const domain = email.slice(at);

  // Nomes de uma ou duas letras não têm meio para esconder; some com tudo em vez
  // de devolver o endereço quase inteiro.
  if (local.length <= 2) return `${'*'.repeat(local.length)}${domain}`;

  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}${domain}`;
}
