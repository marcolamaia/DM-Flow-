import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  randomToken,
  uuidv7,
  type AccountHealth,
  type Channel,
  type NormalizedEvent,
  type SendResult,
} from '@dmflow/shared';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';
import type {
  AuthStartParams,
  ChannelProvider,
  CommentContext,
  ConnectedAccountDraft,
  OutboundMessage,
  SendContext,
} from './channel-provider';

/**
 * A simulator, not a stand-in for the real API.
 *
 * It reproduces the SHAPE of a real integration — signed webhooks, an OAuth
 * handshake, per-account rate limiting, delivery ids, realistic failures — so that
 * every layer above it (ingestion, engine, inbox, analytics, billing) is exercised
 * for real. What it deliberately does NOT do is invent Meta's endpoints, payload
 * field names, permission strings or limits. Those stay unknown until PHASE 0
 * validates them, and the capability registry marks anything sandbox-backed as
 * SANDBOX_SIMULATED so nobody mistakes it for a claim about the live platform.
 */
@Injectable()
export class MockInstagramProvider implements ChannelProvider {
  readonly channel: Channel = 'INSTAGRAM';
  readonly isSandbox = true;

  /** Per-account send counters, so rate limiting behaves like a real constraint. */
  private readonly sendWindow = new Map<string, { count: number; resetAt: number }>();
  private static readonly WINDOW_MS = 60_000;
  private static readonly MAX_PER_WINDOW = 60;

  private get appSecret(): string {
    // The simulator signs with the same secret it verifies, so signature handling is
    // genuinely exercised rather than skipped in development.
    return loadEnv().META_APP_SECRET || loadEnv().SESSION_SECRET;
  }

  getAuthorizationUrl(params: AuthStartParams): string {
    const url = new URL('/sandbox/instagram/authorize', loadEnv().API_URL);
    url.searchParams.set('state', params.state);
    url.searchParams.set('redirect_uri', params.redirectUri);
    return url.toString();
  }

  async completeAuthorization(params: {
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<ConnectedAccountDraft> {
    // The sandbox encodes the chosen handle in the code so a tester can connect
    // several distinct accounts instead of always getting the same one.
    const handle = params.code.startsWith('handle:')
      ? params.code.slice('handle:'.length).replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30)
      : `sandbox_${randomToken(4).toLowerCase()}`;

    return {
      externalAccountId: `ig_sandbox_${handle}`,
      username: handle,
      displayName: handle.replace(/[._]/g, ' '),
      avatarUrl: null as unknown as string,
      accountType: 'BUSINESS',
      // Left empty on purpose: the real scope strings are not confirmed, and
      // inventing plausible ones here would be exactly the failure mode to avoid.
      grantedScopes: [],
      accessToken: `sandbox-token-${randomToken(16)}`,
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
      isSandbox: true,
    };
  }

  async refreshCredentials(input: {
    accountId: string;
    refreshToken?: string;
  }): Promise<{ accessToken: string; expiresAt?: Date } | null> {
    return {
      accessToken: `sandbox-token-${randomToken(16)}`,
      expiresAt: new Date(Date.now() + 60 * 86_400_000),
    };
  }

  async revoke(): Promise<void> {
    // Nothing to call upstream; the account row is what holds the connection.
  }

  async getAccountHealth(input: { accountId: string }): Promise<AccountHealth> {
    return {
      status: 'CONNECTED',
      detail: 'sandbox account',
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
      webhookHealthy: true,
      checkedAt: new Date(),
    };
  }

  // ── Webhooks ───────────────────────────────────────────────

  sign(rawBody: Buffer): string {
    return `sha256=${createHmac('sha256', this.appSecret).update(rawBody).digest('hex')}`;
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = Buffer.from(this.sign(rawBody));
    const received = Buffer.from(signatureHeader);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  }

  handleVerificationChallenge(query: Record<string, string>): string | null {
    const env = loadEnv();
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === env.META_WEBHOOK_VERIFY_TOKEN
    ) {
      return query['hub.challenge'] ?? '';
    }
    return null;
  }

  /**
   * The sandbox emits our own normalised shape directly. A live provider is where
   * the platform's real payload would be translated — and that translation cannot
   * be written until the payload is confirmed.
   */
  normalizeWebhook(raw: unknown): NormalizedEvent[] {
    const payload = raw as { events?: unknown[] };
    const events = Array.isArray(payload?.events) ? payload.events : [];

    return events.flatMap((item): NormalizedEvent[] => {
      const e = item as Record<string, unknown>;
      const type = String(e.type ?? '');
      const externalAccountId = String(e.externalAccountId ?? '');
      const senderId = String((e.sender as Record<string, unknown>)?.externalUserId ?? '');
      if (!type || !externalAccountId || !senderId) return [];

      const base = {
        providerEventId: String(e.providerEventId ?? uuidv7()),
        channel: 'INSTAGRAM' as const,
        externalAccountId,
        sender: {
          externalUserId: senderId,
          username: (e.sender as Record<string, string>)?.username,
          displayName: (e.sender as Record<string, string>)?.displayName,
        },
        occurredAt: e.occurredAt ? new Date(String(e.occurredAt)) : new Date(),
        text: e.text ? String(e.text) : undefined,
        raw: e,
      };

      switch (type) {
        case 'message_received':
          return [
            {
              ...base,
              type: 'message_received',
              externalMessageId: String(e.externalMessageId ?? `msg_${uuidv7()}`),
              externalConversationId: `conv_${externalAccountId}_${senderId}`,
            },
          ];
        case 'comment_created':
          return [
            {
              ...base,
              type: 'comment_created',
              comment: {
                commentId: String(e.commentId ?? `cmt_${uuidv7()}`),
                mediaId: String(e.mediaId ?? 'media_unknown'),
                mediaType: e.mediaType ? String(e.mediaType) : undefined,
              },
            },
          ];
        case 'story_reply':
          return [
            {
              ...base,
              type: 'story_reply',
              externalMessageId: String(e.externalMessageId ?? `msg_${uuidv7()}`),
              externalConversationId: `conv_${externalAccountId}_${senderId}`,
              story: { storyId: String(e.storyId ?? `story_${uuidv7()}`) },
            },
          ];
        case 'story_mention':
          return [
            {
              ...base,
              type: 'story_mention',
              externalMessageId: String(e.externalMessageId ?? `msg_${uuidv7()}`),
              externalConversationId: `conv_${externalAccountId}_${senderId}`,
              story: { storyId: String(e.storyId ?? `story_${uuidv7()}`) },
            },
          ];
        default:
          logger.warn({ type }, 'sandbox provider received an unknown event type');
          return [];
      }
    });
  }

  // ── Outbound ───────────────────────────────────────────────

  async sendMessage(ctx: SendContext, message: OutboundMessage): Promise<SendResult> {
    this.consumeRateBudget(ctx.externalAccountId);

    const text = message.blocks.find((b) => b.type === 'text')?.text ?? '';
    if (text.length > 1000) {
      throw Object.assign(new Error('Message exceeds the simulated 1000 character limit'), {
        providerCode: 'MESSAGE_TOO_LONG',
        retryable: false,
      });
    }
    if ((message.quickReplies?.length ?? 0) > 3) {
      throw Object.assign(new Error('Too many quick replies for the simulated channel'), {
        providerCode: 'TOO_MANY_QUICK_REPLIES',
        retryable: false,
      });
    }

    const usage = this.sendWindow.get(ctx.externalAccountId);
    return {
      externalMessageId: `sbmsg_${uuidv7()}`,
      sentAt: new Date(),
      usage: {
        callsRemaining: MockInstagramProvider.MAX_PER_WINDOW - (usage?.count ?? 0),
        resetAt: usage ? new Date(usage.resetAt) : undefined,
        percentUsed: Math.round(
          ((usage?.count ?? 0) / MockInstagramProvider.MAX_PER_WINDOW) * 100,
        ),
      },
    };
  }

  async replyToComment(ctx: CommentContext, body: string): Promise<SendResult> {
    this.consumeRateBudget(ctx.externalAccountId);
    return { externalMessageId: `sbreply_${uuidv7()}`, sentAt: new Date() };
  }

  async sendPrivateReply(ctx: CommentContext, message: OutboundMessage): Promise<SendResult> {
    this.consumeRateBudget(ctx.externalAccountId);
    return { externalMessageId: `sbpriv_${uuidv7()}`, sentAt: new Date() };
  }

  /**
   * Rate limits are discovered from provider responses in the live path. Here the
   * simulator enforces its own documented ceiling so the limiter, the backoff and
   * the typed RATE_LIMITED failure are all exercised.
   */
  private consumeRateBudget(accountId: string): void {
    const now = Date.now();
    const entry = this.sendWindow.get(accountId);

    if (!entry || entry.resetAt <= now) {
      this.sendWindow.set(accountId, {
        count: 1,
        resetAt: now + MockInstagramProvider.WINDOW_MS,
      });
      return;
    }

    if (entry.count >= MockInstagramProvider.MAX_PER_WINDOW) {
      throw Object.assign(new Error('Simulated rate limit reached'), {
        providerCode: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs: entry.resetAt - now,
      });
    }

    entry.count += 1;
  }
}
