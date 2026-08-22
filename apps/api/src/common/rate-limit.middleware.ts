import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DmFlowError } from '@dmflow/shared';
import { RateLimitService } from './rate-limit.service';
import { loadEnv } from '../config/env';

/**
 * A coarse ceiling on every request from one address, whatever it asks for.
 *
 * The per-route guard cannot see a request for a path that matches no route —
 * Nest answers those with a 404 before any guard runs — so without this a flood
 * aimed at nonexistent paths would be unlimited. Middleware runs first and on
 * everything, which is exactly what a backstop needs.
 *
 * The ceiling is deliberately far above any per-route budget. This is not the
 * limit that shapes normal use; it is the one that stops a firehose.
 */
const CEILING_MULTIPLIER = 20;

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limiter: RateLimitService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const env = loadEnv();
    const decision = await this.limiter.consume(
      `all:ip:${req.ip ?? 'unknown'}`,
      env.RATE_LIMIT_MAX * CEILING_MULTIPLIER,
      env.RATE_LIMIT_WINDOW_MS,
    );

    if (decision.allowed) {
      next();
      return;
    }

    // Middleware sits outside the exception filter's reach on some paths, so the
    // response is written here in the same shape the filter would have produced.
    const error = new DmFlowError('RATE_LIMITED', {
      context: { retryAfterSeconds: decision.resetSeconds, bucket: 'all' },
    });
    res.setHeader('Retry-After', String(decision.resetSeconds));
    res.status(429).json({ error: error.toPayload() });
  }
}
