import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import { loadEnv } from '../config/env';

export interface RequestContext {
  correlationId: string;
  userId?: string;
  workspaceId?: string;
  executionId?: string;
  webhookEventId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Redaction lives in the logger, not in the call sites. Relying on every developer
 * to remember which field is sensitive is how tokens end up in log aggregators.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.accessTokenEnc',
  '*.refreshTokenEnc',
  '*.secret',
  '*.secretEnc',
  '*.totpSecretEnc',
  '*.keyHash',
  '*.tokenHash',
  '*.apiKey',
  '*.client_secret',
  'password',
  'accessToken',
  'refreshToken',
  'secret',
  'token',
];

export function createLogger() {
  const env = loadEnv();
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'dmflow-api', env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const ctx = requestContext.getStore();
      return ctx ? { ...ctx } : {};
    },
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino/file', options: { destination: 1 } }
        : undefined,
  });
}

export const logger = createLogger();

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
