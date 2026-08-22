import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DmFlowError, isDmFlowError, DEFAULT_LOCALE, isLocale, type Locale } from '@dmflow/shared';
import { logger, requestContext } from './logger';

function resolveLocale(req: Request): Locale {
  const header = req.headers['x-dmflow-locale'];
  const value = Array.isArray(header) ? header[0] : header;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Single exit point for every error. Nothing reaches a client that has not been
 * mapped to a catalogued code with a localized, actionable message.
 */
@Catch()
export class DmFlowExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const locale = resolveLocale(req);
    const correlationId = requestContext.getStore()?.correlationId ?? 'unknown';

    const error = this.normalize(exception);
    error.correlationId = correlationId;
    const payload = error.toPayload(locale);

    const logPayload = {
      err: {
        code: payload.code,
        category: payload.category,
        cause: payload.cause,
        context: payload.context,
      },
      path: req.originalUrl,
      method: req.method,
      status: payload.httpStatus,
    };

    if (payload.httpStatus >= 500) {
      logger.error({ ...logPayload, stack: (exception as Error)?.stack }, 'request failed');
    } else {
      logger.warn(logPayload, 'request rejected');
    }

    res.status(payload.httpStatus).json({ error: payload });
  }

  private normalize(exception: unknown): DmFlowError {
    if (isDmFlowError(exception)) return exception;

    if (exception instanceof ZodError) {
      return new DmFlowError('VALIDATION_FAILED', {
        details: exception.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === HttpStatus.NOT_FOUND
          ? 'NOT_FOUND'
          : status === HttpStatus.FORBIDDEN
            ? 'FORBIDDEN'
            : status === HttpStatus.UNAUTHORIZED
              ? 'NOT_AUTHENTICATED'
              : status === HttpStatus.TOO_MANY_REQUESTS
                ? 'RATE_LIMITED'
                : status < 500
                  ? 'VALIDATION_FAILED'
                  : 'INTERNAL_ERROR';
      return new DmFlowError(code, { cause: exception.message });
    }

    // Prisma unique-constraint violations are a conflict, not a server fault.
    const prismaCode = (exception as { code?: string })?.code;
    if (prismaCode === 'P2002') return new DmFlowError('ALREADY_EXISTS');
    if (prismaCode === 'P2025') return new DmFlowError('NOT_FOUND');

    return new DmFlowError('INTERNAL_ERROR', {
      cause: exception instanceof Error ? exception.message : 'unknown',
    });
  }
}
