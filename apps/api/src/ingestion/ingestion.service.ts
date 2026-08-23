import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  uuidv7,
  type Channel,
  type NormalizedEvent,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { TriggerMatcherService } from '../automations/trigger-matcher.service';
import { EngineService } from '../engine/engine.service';
import { QueueService } from '../engine/queue.service';
import { logger } from '../common/logger';

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Messaging windows are governed by rules we have not been able to confirm against
 * official documentation. Until PHASE 0 fills that in, an inbound message opens a
 * window whose duration is only known for the simulator; for a live account the
 * state stays UNKNOWN, and the capability engine refuses to send on UNKNOWN.
 *
 * That is the deliberate trade: a refused send is recoverable, a send that breaks
 * a platform rule may cost the customer their account.
 */
const SANDBOX_WINDOW_HOURS = 24;

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly providers: ProviderRegistry,
    private readonly matcher: TriggerMatcherService,
    private readonly engine: EngineService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Called from the HTTP handler. Does three things only — verify, persist,
   * enqueue — so the endpoint always answers fast. A slow webhook response means
   * lost deliveries, and a lost delivery is data that exists nowhere else.
   */
  async receive(
    channel: Channel,
    rawBody: Buffer,
    signature: string | undefined,
    parsed: unknown,
  ): Promise<{ accepted: boolean; webhookEventId?: string; reason?: string }> {
    const provider = this.providers.forNewConnection(channel);
    const signatureValid = provider.verifyWebhookSignature(rawBody, signature);

    if (!signatureValid) {
      logger.warn({ channel }, 'rejected webhook with invalid signature');
      return { accepted: false, reason: 'invalid_signature' };
    }

    const providerEventId = this.deriveEventId(parsed, rawBody);
    const dedupeKey = `${channel}:${providerEventId}`;

    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          id: uuidv7(),
          channel,
          providerEventId,
          dedupeKey,
          rawPayload: parsed as never,
          signatureValid: true,
          status: 'RECEIVED',
        },
      });

      await this.queue.enqueueIngestion(event.id);
      return { accepted: true, webhookEventId: event.id };
    } catch (error) {
      // Unique violation on (channel, providerEventId): the platform redelivered
      // something we already hold. Accepting silently is correct — the sender only
      // needs to know we have it.
      if ((error as { code?: string }).code === 'P2002') {
        return { accepted: true, reason: 'duplicate' };
      }
      throw error;
    }
  }

  /** Worker side: normalise, resolve, persist, match, run. */
  async process(webhookEventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) return;
    if (event.status === 'PROCESSED' || event.status === 'DISCARDED') return;

    // Redis dedupe is a fast path; the row status is the real guard.
    const claimed = await this.redis.claimOnce(`wh:${event.dedupeKey}`, DEDUPE_TTL_SECONDS);
    if (!claimed && event.status === 'PROCESSING') {
      logger.debug({ webhookEventId }, 'webhook already being processed');
      return;
    }

    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });

    try {
      const provider = this.providers.forNewConnection(event.channel);
      const normalized = provider.normalizeWebhook(event.rawPayload);

      if (normalized.length === 0) {
        await this.discard(webhookEventId, 'no_normalizable_events');
        return;
      }

      let workspaceId: string | null = null;
      for (const item of normalized) {
        const result = await this.handleEvent(item, webhookEventId);
        if (result.workspaceId) workspaceId = result.workspaceId;
      }

      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'PROCESSED', processedAt: new Date(), workspaceId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'FAILED', lastError: message.slice(0, 500) },
      });
      throw error;
    }
  }

  private async handleEvent(
    event: NormalizedEvent,
    webhookEventId: string,
  ): Promise<{ workspaceId: string | null }> {
    const account = await this.prisma.connectedAccount.findUnique({
      where: {
        channel_externalAccountId: {
          channel: event.channel,
          externalAccountId: event.externalAccountId,
        },
      },
    });

    // An event for an account we do not hold is not an error to retry forever.
    if (!account || account.deletedAt) {
      logger.debug({ externalAccountId: event.externalAccountId }, 'event for unknown account');
      return { workspaceId: null };
    }

    const workspaceId = account.workspaceId;

    const contact = await this.resolveContact(workspaceId, account.id, event);
    const conversation = await this.resolveConversation(
      workspaceId,
      account.id,
      contact.id,
      event,
      account.isSandbox,
    );

    if (event.externalMessageId && event.text !== undefined) {
      await this.persistInboundMessage(workspaceId, conversation.id, event);
    }

    // A reply the flow is already waiting for takes precedence over starting
    // something new. Otherwise answering "yes" to one automation would enrol the
    // contact in a second one that happens to listen for the same word, and they
    // would get two conversations at once from a single message.
    if (event.text !== undefined) {
      const resumed = await this.engine.deliverReply({
        workspaceId,
        conversationId: conversation.id,
        text: event.text ?? '',
        quickReplyPayload: event.quickReplyPayload ?? null,
      });
      if (resumed > 0) return { workspaceId };
    }

    const outcome = await this.matcher.match(workspaceId, account.id, event);

    if (!outcome.selected) {
      logger.debug(
        { workspaceId, eventType: event.type, rejected: outcome.rejected.length },
        'no trigger matched',
      );
      return { workspaceId };
    }

    const started = await this.engine.start({
      workspaceId,
      automationId: outcome.selected.automationId,
      contactId: contact.id,
      conversationId: conversation.id,
      connectedAccountId: account.id,
      triggerId: outcome.selected.triggerId,
      triggerEventId: webhookEventId,
      variables: {
        trigger: {
          type: outcome.selected.type,
          text: event.text ?? null,
        },
      },
      origin: {
        triggerType: outcome.selected.type,
        eventType: event.type,
        commentId: event.comment?.commentId,
        mediaId: event.comment?.mediaId,
        text: event.text,
      },
    });

    logger.info(
      {
        workspaceId,
        eventType: event.type,
        triggerType: outcome.selected.type,
        alsoMatched: outcome.alsoMatched.length,
        result: 'executionId' in started ? 'started' : started.skipped,
      },
      'trigger matched',
    );

    return { workspaceId };
  }

  private async resolveContact(
    workspaceId: string,
    connectedAccountId: string,
    event: NormalizedEvent,
  ) {
    const identity = await this.prisma.contactIdentity.findUnique({
      where: {
        channel_connectedAccountId_externalUserId: {
          channel: event.channel,
          connectedAccountId,
          externalUserId: event.sender.externalUserId,
        },
      },
      include: { contact: true },
    });

    if (identity) {
      await this.prisma.contact.update({
        where: { id: identity.contactId },
        data: {
          lastInteractionAt: event.occurredAt,
          // Handles change; keeping the latest avoids a stale @ in the inbox.
          username: event.sender.username ?? identity.contact.username,
          displayName: event.sender.displayName ?? identity.contact.displayName,
        },
      });
      return identity.contact;
    }

    const contactId = uuidv7();
    const contact = await this.prisma.contact.create({
      data: {
        id: contactId,
        workspaceId,
        primaryChannel: event.channel,
        displayName: event.sender.displayName ?? event.sender.username ?? null,
        username: event.sender.username ?? null,
        source: event.type,
        firstSeenAt: event.occurredAt,
        lastInteractionAt: event.occurredAt,
      },
    });

    await this.prisma.contactIdentity.create({
      data: {
        id: uuidv7(),
        workspaceId,
        contactId,
        channel: event.channel,
        connectedAccountId,
        externalUserId: event.sender.externalUserId,
        username: event.sender.username ?? null,
      },
    });

    return contact;
  }

  private async resolveConversation(
    workspaceId: string,
    connectedAccountId: string,
    contactId: string,
    event: NormalizedEvent,
    isSandbox: boolean,
  ) {
    const existing = await this.prisma.conversation.findUnique({
      where: { connectedAccountId_contactId: { connectedAccountId, contactId } },
    });

    // Only an inbound message from the person opens or refreshes a window. A public
    // comment does not: replying to it privately is a separate, one-shot mechanism.
    const opensWindow =
      event.type === 'message_received' ||
      event.type === 'story_reply' ||
      event.type === 'story_mention';

    const windowState = opensWindow ? (isSandbox ? 'OPEN' : 'UNKNOWN') : undefined;
    const windowExpiresAt =
      opensWindow && isSandbox
        ? new Date(event.occurredAt.getTime() + SANDBOX_WINDOW_HOURS * 3_600_000)
        : undefined;
    const windowBasis = opensWindow
      ? isSandbox
        ? 'sandbox:simulated-24h'
        : 'live:unconfirmed-pending-phase-0'
      : undefined;

    if (existing) {
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastInboundAt: opensWindow ? event.occurredAt : existing.lastInboundAt,
          unreadCount: opensWindow ? { increment: 1 } : undefined,
          status: existing.status === 'CLOSED' ? 'OPEN' : existing.status,
          ...(windowState ? { windowState, windowExpiresAt, windowBasis } : {}),
        },
      });
    }

    return this.prisma.conversation.create({
      data: {
        id: uuidv7(),
        workspaceId,
        contactId,
        connectedAccountId,
        channel: event.channel,
        externalConversationId: event.externalConversationId ?? null,
        status: 'OPEN',
        lastInboundAt: opensWindow ? event.occurredAt : null,
        unreadCount: opensWindow ? 1 : 0,
        windowState: windowState ?? 'UNKNOWN',
        windowExpiresAt: windowExpiresAt ?? null,
        windowBasis: windowBasis ?? null,
      },
    });
  }

  private async persistInboundMessage(
    workspaceId: string,
    conversationId: string,
    event: NormalizedEvent,
  ): Promise<void> {
    try {
      await this.prisma.message.create({
        data: {
          id: uuidv7(),
          workspaceId,
          conversationId,
          direction: 'INBOUND',
          externalMessageId: event.externalMessageId ?? null,
          senderType: 'CONTACT',
          contentType: event.type === 'story_mention' ? 'story_mention' : 'text',
          content: {
            text: event.text ?? '',
            eventType: event.type,
            story: event.story ?? null,
          } as never,
          status: 'DELIVERED',
          sentAt: event.occurredAt,
        },
      });
    } catch (error) {
      // Unique on (workspaceId, externalMessageId): a redelivery, already stored.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }

  private async discard(webhookEventId: string, reason: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'DISCARDED', discardReason: reason, processedAt: new Date() },
    });
  }

  /**
   * Derives a stable id when the payload carries none, so redelivery of the same
   * bytes is still recognised as a duplicate rather than processed twice.
   */
  private deriveEventId(parsed: unknown, rawBody: Buffer): string {
    const candidate = (parsed as { events?: Array<{ providerEventId?: string }> })?.events?.[0]
      ?.providerEventId;
    if (candidate) return String(candidate).slice(0, 120);
    return createHash('sha256').update(rawBody).digest('hex').slice(0, 48);
  }

  // ── Operations ─────────────────────────────────────────────

  async listEvents(workspaceId: string, limit = 50) {
    return this.prisma.webhookEvent.findMany({
      where: { workspaceId },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        channel: true,
        providerEventId: true,
        status: true,
        discardReason: true,
        attemptCount: true,
        lastError: true,
        receivedAt: true,
        processedAt: true,
      },
    });
  }

  /**
   * Replays stored events. Outbound side effects are suppressed by default: a
   * replay that re-sent every private reply for a day would be unrecoverable, since
   * those attempts may be permitted only once per comment.
   */
  async replay(
    workspaceId: string,
    eventIds: string[],
    options: { withSideEffects: boolean },
  ): Promise<{ replayed: number; suppressed: boolean }> {
    const events = await this.prisma.webhookEvent.findMany({
      where: { id: { in: eventIds }, workspaceId },
      select: { id: true },
    });

    if (!options.withSideEffects) {
      // Dry run: report what would be reprocessed without touching the outside world.
      return { replayed: events.length, suppressed: true };
    }

    for (const event of events) {
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'RECEIVED', lastError: null },
      });
      await this.queue.enqueueIngestion(event.id);
    }

    return { replayed: events.length, suppressed: false };
  }
}
