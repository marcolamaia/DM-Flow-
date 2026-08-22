import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { DmFlowError } from '@dmflow/shared';
import { RateLimitService, type RateLimitDecision } from './rate-limit.service';
import { SESSION_COOKIE } from '../auth/session.service';
import { loadEnv } from '../config/env';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './decorators/rate-limit.decorator';

/** Health checks are what a load balancer uses to decide we are alive. Never throttle them. */
const EXEMPT_PREFIXES = ['/health'];

const DEFAULT_IP_MULTIPLIER = 4;

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

/**
 * Rate limiting, applied to every route.
 *
 * This runs before authentication so that an attacker spamming forged session
 * tokens is stopped by a Redis counter rather than by a database lookup per
 * request. That means the caller cannot be identified by anything the server has
 * verified yet, which decides the shape of the limit:
 *
 * Every request is counted against its source address, because that is the one
 * thing the caller cannot change at will. A presented credential — API key or
 * session cookie — only ever *adds* a second, tighter bucket. Keying on the
 * credential alone would be worthless here: rotating a random cookie per request
 * would mint a fresh budget every time.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.originalUrl ?? req.url ?? '';

    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

    const env = loadEnv();
    const options: RateLimitOptions = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? {
      limit: env.RATE_LIMIT_MAX,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      bucket: 'default',
    };

    const multiplier = options.ipMultiplier ?? DEFAULT_IP_MULTIPLIER;
    const credential = this.credential(req);

    const decisions: RateLimitDecision[] = [
      await this.limiter.consume(
        `${options.bucket}:ip:${req.ip ?? 'unknown'}`,
        options.limit * multiplier,
        options.windowMs,
      ),
    ];

    if (credential) {
      decisions.push(
        await this.limiter.consume(
          `${options.bucket}:c:${fingerprint(credential)}`,
          options.limit,
          options.windowMs,
        ),
      );
    }

    // Report whichever bucket is closest to running out — telling a client it has
    // 400 requests left when another bucket will refuse it at 3 is a lie.
    const tightest = decisions.reduce((a, b) => (b.remaining < a.remaining ? b : a));

    // Advertised on every response, not only on rejection, so a well-behaved
    // client can slow down before it is refused.
    res.setHeader('RateLimit-Limit', String(tightest.limit));
    res.setHeader('RateLimit-Remaining', String(tightest.remaining));
    res.setHeader('RateLimit-Reset', String(tightest.resetSeconds));

    const refused = decisions.find((decision) => !decision.allowed);
    if (refused) {
      throw new DmFlowError('RATE_LIMITED', {
        context: { retryAfterSeconds: refused.resetSeconds, bucket: options.bucket },
      });
    }

    return true;
  }

  /** The credential the caller presented, if any. Unverified — it is only a key. */
  private credential(req: Request): string | null {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.length > 0) return `k:${auth}`;

    const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
    const session = cookies?.[SESSION_COOKIE];
    if (typeof session === 'string' && session.length > 0) return `s:${session}`;

    return null;
  }
}
