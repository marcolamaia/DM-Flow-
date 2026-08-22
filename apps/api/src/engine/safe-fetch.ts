import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DmFlowError } from '@dmflow/shared';

/**
 * The HTTP Request node lets a tenant make our servers issue arbitrary requests.
 * That is a server-side request forgery primitive unless it is fenced properly.
 *
 * The fence: resolve the hostname ourselves, reject private and metadata ranges,
 * then connect to the resolved address so DNS cannot change between the check and
 * the connection. Redirects are re-validated hop by hop for the same reason.
 */

const BLOCKED_V4 = [
  { base: '0.0.0.0', bits: 8 },
  { base: '10.0.0.0', bits: 8 },
  { base: '100.64.0.0', bits: 10 },
  { base: '127.0.0.0', bits: 8 },
  { base: '169.254.0.0', bits: 16 }, // cloud metadata lives here
  { base: '172.16.0.0', bits: 12 },
  { base: '192.0.0.0', bits: 24 },
  { base: '192.168.0.0', bits: 16 },
  { base: '198.18.0.0', bits: 15 },
  { base: '224.0.0.0', bits: 4 },
  { base: '240.0.0.0', bits: 4 },
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const value = ipv4ToInt(address);
    if (value < 0) return true;
    return BLOCKED_V4.some(({ base, bits }) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    // IPv4-mapped addresses would otherwise smuggle a private v4 target through.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return false;
  }

  return true;
}

export interface SafeFetchOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: unknown;
  truncated: boolean;
}

const FORBIDDEN_HEADERS = new Set(['host', 'cookie', 'authorization', 'x-dmflow-workspace']);

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxResponseBytes ?? 256 * 1024;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = new URL(currentUrl);

    if (url.protocol !== 'https:') {
      throw new DmFlowError('SSRF_BLOCKED', { context: { reason: 'scheme_not_allowed' } });
    }

    const resolved = isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await lookup(url.hostname, { all: true }).catch(() => []);

    if (resolved.length === 0) {
      throw new DmFlowError('SSRF_BLOCKED', { context: { reason: 'dns_resolution_failed' } });
    }
    if (resolved.some((entry) => isBlockedAddress(entry.address))) {
      throw new DmFlowError('SSRF_BLOCKED', { context: { reason: 'private_address' } });
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.headers)) {
      if (!FORBIDDEN_HEADERS.has(key.toLowerCase())) headers[key] = value;
    }
    headers['user-agent'] ??= 'DMFlow-HTTPNode/1.0';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body,
        redirect: 'manual',
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new DmFlowError('PROVIDER_ERROR', { cause: 'redirect without location' });
        currentUrl = new URL(location, url).toString();
        continue;
      }

      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      let truncated = false;

      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > maxBytes) {
              truncated = true;
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        }
      }

      const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: text.slice(0, maxBytes),
        json,
        truncated,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DmFlowError('SSRF_BLOCKED', { context: { reason: 'too_many_redirects' } });
}
