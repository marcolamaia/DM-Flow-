import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { logger } from './logger';

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. Never below 1. */
  resetSeconds: number;
}

/**
 * Fixed-window counter in Redis.
 *
 * INCR and the expiry have to be one round trip, otherwise a process that dies
 * between them leaves a key with no TTL and that caller is blocked forever. The
 * script sets the expiry only on the first increment, so the window is anchored
 * to the first request rather than sliding forward with every hit.
 */
const SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    try {
      const [countRaw, ttlRaw] = (await this.redis.client.eval(
        SCRIPT,
        1,
        `rl:${key}`,
        String(windowMs),
      )) as [number, number];

      const count = Number(countRaw);
      const ttlMs = Number(ttlRaw);
      const resetSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000));

      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetSeconds,
      };
    } catch (error) {
      // Redis being down must not take the whole API down with it. Losing rate
      // limiting is a degradation; refusing every request is an outage.
      logger.error(
        { err: error instanceof Error ? error.message : String(error), key },
        'rate limit check failed, allowing request',
      );
      return { allowed: true, limit, remaining: limit, resetSeconds: 1 };
    }
  }

  /** Clears a bucket. Used after a successful login so one typo does not cost the window. */
  async reset(key: string): Promise<void> {
    await this.redis.client.del(`rl:${key}`).catch(() => undefined);
  }
}
