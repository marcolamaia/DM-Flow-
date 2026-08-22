import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { logger, requestContext } from './common/logger';
import { RedisService } from './redis/redis.service';
import { EngineService } from './engine/engine.service';
import { IngestionService } from './ingestion/ingestion.service';
import { PrismaService } from './prisma/prisma.service';
import { BillingService } from './billing/billing.service';
import { QUEUE_NAMES, type EngineJob, type IngestionJob } from './engine/queues';
import { uuidv7 } from '@dmflow/shared';

/**
 * Runs in its own process, never alongside the HTTP server.
 *
 * The webhook endpoint has to answer in milliseconds or the platform stops
 * delivering. If a slow automation could occupy the same thread pool, a traffic
 * spike would turn into lost events — and a lost event exists nowhere else.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const redis = app.get(RedisService);
  const engine = app.get(EngineService);
  const ingestion = app.get(IngestionService);
  const prisma = app.get(PrismaService);
  const billing = app.get(BillingService);

  const connection = redis.queueConnection;

  const withContext = <T>(fn: () => Promise<T>): Promise<T> =>
    requestContext.run({ correlationId: uuidv7() }, fn);

  const ingestionWorker = new Worker<IngestionJob>(
    QUEUE_NAMES.ingestion,
    (job: Job<IngestionJob>) => withContext(() => ingestion.process(job.data.webhookEventId)),
    { connection, concurrency: 8 },
  );

  const engineWorker = new Worker<EngineJob>(
    QUEUE_NAMES.engine,
    (job: Job<EngineJob>) => withContext(() => engine.advance(job.data.executionId)),
    { connection, concurrency: 8 },
  );

  for (const [name, worker] of [
    ['ingestion', ingestionWorker],
    ['engine', engineWorker],
  ] as const) {
    worker.on('failed', (job, err) => {
      const exhausted = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : false;
      logger.error(
        {
          queue: name,
          jobId: job?.id,
          attempts: job?.attemptsMade,
          // A job that has exhausted its attempts is now in the dead-letter set and
          // needs a human, not another retry.
          deadLettered: exhausted,
          err: err.message,
        },
        exhausted ? 'job dead-lettered' : 'job failed, will retry',
      );
    });
    worker.on('error', (err) => logger.error({ queue: name, err: err.message }, 'worker error'));
  }

  // ── Scheduler
  // Delays live in Postgres, so waking is a database scan rather than a queue timer.
  // A flushed Redis must never strand a conversation mid-flow.
  const tick = async (): Promise<void> => {
    try {
      const woken = await engine.wakeDueExecutions();
      if (woken > 0) logger.info({ woken }, 'woke delayed executions');
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'scheduler tick failed');
    }
  };

  const schedulerInterval = setInterval(() => void tick(), 10_000);
  void tick();

  // ── Maintenance: hourly housekeeping the product depends on being true.
  const maintenance = async (): Promise<void> => {
    try {
      // Suspension only happens after the grace period has genuinely elapsed.
      const suspended = await billing.suspendOverdueWorkspaces();
      if (suspended > 0) logger.warn({ suspended }, 'workspaces suspended for non-payment');

      const expired = await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { not: null, lte: new Date() } },
      });
      const staleSessions = await prisma.session.deleteMany({
        where: { expiresAt: { lte: new Date(Date.now() - 30 * 86_400_000) } },
      });
      if (expired.count || staleSessions.count) {
        logger.info(
          { idempotencyRecords: expired.count, sessions: staleSessions.count },
          'maintenance cleanup',
        );
      }
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'maintenance failed');
    }
  };
  const maintenanceInterval = setInterval(() => void maintenance(), 3_600_000);

  logger.info(
    { env: env.NODE_ENV, queues: Object.values(QUEUE_NAMES) },
    'dmflow worker started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    clearInterval(schedulerInterval);
    clearInterval(maintenanceInterval);
    // Closing the workers lets in-flight jobs finish instead of losing them.
    await Promise.allSettled([ingestionWorker.close(), engineWorker.close()]);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.fatal(
    { err: error instanceof Error ? error.message : String(error) },
    'worker failed to start',
  );
  process.exit(1);
});
