import { Queue, type JobsOptions } from 'bullmq';
import type Redis from 'ioredis';

export const QUEUE_NAMES = {
  ingestion: 'dmflow-ingestion',
  engine: 'dmflow-engine',
  outboundWebhook: 'dmflow-outbound-webhook',
  maintenance: 'dmflow-maintenance',
} as const;

export interface IngestionJob {
  webhookEventId: string;
}

export interface EngineJob {
  executionId: string;
  reason: 'start' | 'resume' | 'retry';
}

export interface OutboundWebhookJob {
  deliveryId: string;
}

/**
 * Retries distinguish transient from terminal upstream. Attempt counts are small on
 * purpose: a flow that hammers a broken endpoint twenty times is worse for the
 * customer than one that stops and says clearly what failed.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 1_000, age: 86_400 },
  removeOnFail: { count: 5_000, age: 7 * 86_400 },
};

export function createQueues(connection: Redis) {
  return {
    ingestion: new Queue<IngestionJob>(QUEUE_NAMES.ingestion, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    engine: new Queue<EngineJob>(QUEUE_NAMES.engine, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    outboundWebhook: new Queue<OutboundWebhookJob>(QUEUE_NAMES.outboundWebhook, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 8 },
    }),
  };
}

export type QueueSet = ReturnType<typeof createQueues>;
