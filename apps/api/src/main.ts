import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { logger } from './common/logger';
import { DmFlowExceptionFilter } from './common/exception.filter';

/**
 * Signature verification needs the exact bytes the sender signed, so the raw body
 * is captured before JSON parsing for webhook routes. Parsing first and
 * re-serialising produces a different byte sequence and every signature fails.
 */
const RAW_BODY_PREFIXES = ['/webhooks/', '/billing/stripe/webhook'];

function needsRawBody(url: string): boolean {
  return RAW_BODY_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: false,
  });

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        if (needsRawBody((req as express.Request).originalUrl ?? '')) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(
    helmet({
      contentSecurityPolicy: false, // the API serves JSON; the web app sets its own CSP
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.enableCors({
    origin: [env.WEB_URL],
    credentials: true,
    exposedHeaders: ['x-correlation-id'],
  });

  app.useGlobalFilters(new DmFlowExceptionFilter());
  app.set('trust proxy', 1);

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV, instagramProvider: env.INSTAGRAM_PROVIDER },
    'dmflow api listening',
  );
}

bootstrap().catch((error) => {
  // Configuration errors must be loud and fatal, not swallowed into a restart loop.
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'api failed to start');
  process.exit(1);
});
