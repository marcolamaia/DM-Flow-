import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DmFlowError, randomToken, uuidv7 } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecretBox } from '../common/crypto';
import { safeFetch } from '../engine/safe-fetch';
import { QueueService } from '../engine/queue.service';
import { QuotaService } from '../billing/quota.service';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';

export const OUTBOUND_EVENTS = [
  'contact.created',
  'contact.tagged',
  'conversation.started',
  'message.received',
  'message.sent',
  'execution.completed',
  'execution.failed',
] as const;

export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];

const MAX_ATTEMPTS = 8;

@Injectable()
export class OutboundWebhooksService {
  private readonly secretBox = new SecretBox(loadEnv().ENCRYPTION_KEY);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly quota: QuotaService,
  ) {}

  async list(workspaceId: string) {
    const hooks = await this.prisma.outboundWebhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    // The secret is shown once at creation and never again.
    return hooks.map((h) => ({
      id: h.id,
      name: h.name,
      url: h.url,
      events: h.events,
      enabled: h.enabled,
      createdAt: h.createdAt,
    }));
  }

  async create(
    workspaceId: string,
    input: { name: string; url: string; events: string[] },
  ): Promise<{ id: string; secret: string }> {
    await this.quota.assertFeature(workspaceId, 'outbound_webhooks');

    const invalid = input.events.filter(
      (e) => !(OUTBOUND_EVENTS as readonly string[]).includes(e),
    );
    if (invalid.length > 0) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'events', message: `unknown events: ${invalid.join(', ')}` }],
      });
    }

    const secret = randomToken(32);
    const hook = await this.prisma.outboundWebhook.create({
      data: {
        id: uuidv7(),
        workspaceId,
        name: input.name.trim(),
        url: input.url,
        secretEnc: this.secretBox.encrypt(secret),
        events: input.events,
      },
    });

    return { id: hook.id, secret };
  }

  async remove(workspaceId: string, id: string) {
    const hook = await this.prisma.outboundWebhook.findUnique({ where: { id } });
    this.prisma.assertTenant(hook, workspaceId);
    await this.prisma.outboundWebhook.delete({ where: { id } });
    return { ok: true };
  }

  /** Fans an internal event out to every subscribed endpoint. */
  async emit(workspaceId: string, eventType: OutboundEvent, payload: unknown): Promise<void> {
    const hooks = await this.prisma.outboundWebhook.findMany({
      where: { workspaceId, enabled: true, events: { has: eventType } },
    });
    if (hooks.length === 0) return;

    for (const hook of hooks) {
      const delivery = await this.prisma.outboundWebhookDelivery.create({
        data: {
          id: uuidv7(),
          workspaceId,
          outboundWebhookId: hook.id,
          eventType,
          payload: payload as never,
        },
      });
      await this.queue.enqueueOutboundWebhook(delivery.id);
    }
  }

  /**
   * Delivers one attempt. Signed the same way we expect inbound webhooks to be
   * signed, so a customer receiving from us can verify exactly as we do.
   */
  async deliver(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.outboundWebhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery || delivery.status === 'DELIVERED') return;

    const secret = this.secretBox.decrypt(delivery.webhook.secretEnc);
    const body = JSON.stringify({
      id: delivery.id,
      type: delivery.eventType,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    const attempt = delivery.attemptCount + 1;

    try {
      const response = await safeFetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dmflow-signature-256': signature,
          'x-dmflow-event': delivery.eventType,
          'x-dmflow-delivery': delivery.id,
        },
        body,
        timeoutMs: 10_000,
      });

      const delivered = response.status >= 200 && response.status < 300;

      await this.prisma.outboundWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attemptCount: attempt,
          responseStatus: response.status,
          responseBody: response.body.slice(0, 500),
          status: delivered ? 'DELIVERED' : attempt >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          nextAttemptAt: delivered ? null : new Date(Date.now() + this.backoffMs(attempt)),
        },
      });

      if (!delivered && attempt < MAX_ATTEMPTS) {
        await this.queue.enqueueOutboundWebhook(deliveryId, this.backoffMs(attempt));
      }
    } catch (error) {
      logger.warn(
        { deliveryId, attempt, err: (error as Error).message },
        'outbound webhook delivery failed',
      );
      await this.prisma.outboundWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attemptCount: attempt,
          responseBody: (error as Error).message.slice(0, 300),
          status: attempt >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + this.backoffMs(attempt)),
        },
      });
      if (attempt < MAX_ATTEMPTS) {
        await this.queue.enqueueOutboundWebhook(deliveryId, this.backoffMs(attempt));
      }
    }
  }

  async listDeliveries(workspaceId: string, webhookId: string, limit = 25) {
    const hook = await this.prisma.outboundWebhook.findUnique({ where: { id: webhookId } });
    this.prisma.assertTenant(hook, workspaceId);

    return this.prisma.outboundWebhookDelivery.findMany({
      where: { outboundWebhookId: webhookId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        status: true,
        responseStatus: true,
        attemptCount: true,
        nextAttemptAt: true,
        createdAt: true,
      },
    });
  }

  private backoffMs(attempt: number): number {
    // Capped exponential: a customer's endpoint being down for an hour should not
    // mean we stop trying, nor that we hammer it every second.
    return Math.min(2 ** attempt * 1000, 30 * 60_000);
  }
}
