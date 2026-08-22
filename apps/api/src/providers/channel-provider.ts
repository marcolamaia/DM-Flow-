import type {
  AccountHealth,
  Channel,
  NormalizedEvent,
  SendResult,
} from '@dmflow/shared';

export interface OutboundMessageBlock {
  type: 'text' | 'image' | 'video' | 'audio';
  text?: string;
  url?: string;
  caption?: string;
}

export interface OutboundMessage {
  blocks: OutboundMessageBlock[];
  quickReplies?: Array<{ id: string; title: string }>;
}

export interface SendContext {
  accountId: string;
  accessToken: string;
  externalAccountId: string;
  recipientExternalId: string;
  conversationId?: string;
  correlationId?: string;
}

export interface CommentContext {
  accountId: string;
  accessToken: string;
  externalAccountId: string;
  commentId: string;
  mediaId: string;
  correlationId?: string;
}

export interface AuthStartParams {
  workspaceId: string;
  redirectUri: string;
  state: string;
}

export interface ConnectedAccountDraft {
  externalAccountId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  accountType?: string;
  grantedScopes: string[];
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  isSandbox: boolean;
}

/**
 * Defined by our domain, not by any platform's wire format. That is what lets a
 * channel be added without the engine learning anything about it.
 *
 * Optional methods exist because a channel must be able to say honestly that it
 * does not support something. Implementing one by faking it would be worse than
 * not having it: the flow would look valid and the message would never arrive.
 */
export interface ChannelProvider {
  readonly channel: Channel;
  readonly isSandbox: boolean;

  getAuthorizationUrl(params: AuthStartParams): string;
  completeAuthorization(params: {
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<ConnectedAccountDraft>;
  refreshCredentials(input: {
    accountId: string;
    refreshToken?: string;
  }): Promise<{ accessToken: string; expiresAt?: Date } | null>;
  revoke(input: { accountId: string; accessToken: string }): Promise<void>;
  getAccountHealth(input: { accountId: string; accessToken: string }): Promise<AccountHealth>;

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  handleVerificationChallenge(query: Record<string, string>): string | null;
  normalizeWebhook(raw: unknown): NormalizedEvent[];

  sendMessage(ctx: SendContext, message: OutboundMessage): Promise<SendResult>;
  replyToComment?(ctx: CommentContext, body: string): Promise<SendResult>;
  sendPrivateReply?(ctx: CommentContext, message: OutboundMessage): Promise<SendResult>;
}

/**
 * Thrown when code reaches a capability that has not been validated against the
 * platform's official documentation. It never falls back to "try anyway".
 */
export class CapabilityNotValidatedError extends Error {
  constructor(
    readonly capabilityId: string,
    readonly channel: Channel,
  ) {
    super(
      `Capability ${capabilityId} on ${channel} has not been validated against official ` +
        `documentation. Complete PHASE 0 and update docs/meta-capabilities.md before enabling it.`,
    );
    this.name = 'CapabilityNotValidatedError';
  }
}
