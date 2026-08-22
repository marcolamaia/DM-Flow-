import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from '@dmflow/shared';
import { requestContext } from './logger';

/**
 * Every request gets a correlation id that follows it into queues, the engine and
 * provider calls, and is shown to the user on failure so support can trace it.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.slice(0, 64) || uuidv7();

    res.setHeader('x-correlation-id', correlationId);
    requestContext.run({ correlationId }, () => next());
  }
}
