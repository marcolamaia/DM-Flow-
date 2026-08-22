import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { createQueues, type QueueSet } from './queues';

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly queues: QueueSet;

  constructor(private readonly redis: RedisService) {
    this.queues = createQueues(this.redis.queueConnection);
  }

  async enqueueIngestion(webhookEventId: string): Promise<void> {
    await this.queues.ingestion.add(
      'process',
      { webhookEventId },
      // The event id is the job id, so a duplicate delivery cannot create a second
      // job even if the same webhook arrives twice.
      { jobId: `wh-${webhookEventId}` },
    );
  }

  async enqueueExecution(
    executionId: string,
    reason: 'start' | 'resume' | 'retry',
    delayMs = 0,
  ): Promise<void> {
    await this.queues.engine.add(
      'advance',
      { executionId, reason },
      { jobId: `exec-${executionId}-${reason}-${Date.now()}`, delay: delayMs },
    );
  }

  async enqueueOutboundWebhook(deliveryId: string, delayMs = 0): Promise<void> {
    await this.queues.outboundWebhook.add(
      'deliver',
      { deliveryId },
      { jobId: `owh-${deliveryId}`, delay: delayMs },
    );
  }

  async health() {
    const [ingestion, engine, outbound] = await Promise.all([
      this.queues.ingestion.getJobCounts(),
      this.queues.engine.getJobCounts(),
      this.queues.outboundWebhook.getJobCounts(),
    ]);
    return { ingestion, engine, outboundWebhook: outbound };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(Object.values(this.queues).map((q) => q.close()));
  }
}
