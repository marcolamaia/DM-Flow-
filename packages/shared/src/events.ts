import type { Channel } from './capabilities.js';

/**
 * Providers normalise their wire format into these. The engine only ever sees
 * NormalizedEvent, which is why adding a channel does not touch the engine.
 */
export type NormalizedEventType =
  | 'message_received'
  | 'comment_created'
  | 'story_reply'
  | 'story_mention'
  | 'message_delivered'
  | 'message_read'
  | 'postback';

export interface NormalizedSender {
  externalUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface NormalizedEvent {
  /** Stable per-event id from the provider; drives dedupe. */
  providerEventId: string;
  type: NormalizedEventType;
  channel: Channel;
  /** External id of the account that received the event. */
  externalAccountId: string;
  sender: NormalizedSender;
  occurredAt: Date;
  /** Text payload where the event carries one. */
  text?: string;
  /**
   * Identifier of the quick reply the contact tapped, when the channel reports
   * one. Absent is meaningful: it means the channel did not say, not that the
   * contact typed — the two are different and must not be conflated.
   */
  quickReplyPayload?: string;
  externalMessageId?: string;
  externalConversationId?: string;
  /** Comment events carry the comment and its parent media. */
  comment?: {
    commentId: string;
    mediaId: string;
    mediaType?: string;
    parentCommentId?: string;
  };
  story?: {
    storyId: string;
    mediaUrl?: string;
  };
  attachments?: Array<{ type: string; url: string }>;
  postback?: { payload: string; title?: string };
  /** Anything the provider wants preserved for debugging. */
  raw?: Record<string, unknown>;
}

export const WINDOW_STATES = ['OPEN', 'EXTENDED', 'CLOSED', 'UNKNOWN'] as const;
export type WindowState = (typeof WINDOW_STATES)[number];

/** Result of an outbound send, normalised across channels. */
export interface SendResult {
  externalMessageId?: string;
  sentAt: Date;
  /** Usage reported by the provider, used to self-tune the rate limiter. */
  usage?: { callsRemaining?: number; resetAt?: Date; percentUsed?: number };
}

export interface AccountHealth {
  status: string;
  detail?: string;
  tokenExpiresAt?: Date | null;
  webhookHealthy: boolean;
  checkedAt: Date;
}
