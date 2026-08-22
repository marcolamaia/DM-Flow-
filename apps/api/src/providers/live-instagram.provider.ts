import { Injectable } from '@nestjs/common';
import { CAP, type AccountHealth, type Channel, type NormalizedEvent, type SendResult } from '@dmflow/shared';
import { CapabilityNotValidatedError, type ChannelProvider } from './channel-provider';

/**
 * Placeholder for the real Instagram integration.
 *
 * Every method refuses rather than guesses. Writing a plausible endpoint here would
 * produce code that compiles, passes a hand-written mock, ships, and then fails in
 * front of a paying customer — which is precisely the failure this project is built
 * to avoid.
 *
 * To implement it: complete PHASE 0 (see MASTER_PROMPT §4), fill in
 * docs/meta-capabilities.md with endpoints, scopes, payload shapes and limits read
 * from Meta's current official documentation, flip the matching registry entries
 * off NOT_CONFIRMED, then replace these bodies. Nothing else in the codebase has to
 * change: the engine only knows this interface.
 */
@Injectable()
export class LiveInstagramProvider implements ChannelProvider {
  readonly channel: Channel = 'INSTAGRAM';
  readonly isSandbox = false;

  private refuse(capabilityId: string): never {
    throw new CapabilityNotValidatedError(capabilityId, this.channel);
  }

  getAuthorizationUrl(): string {
    this.refuse(CAP.IG_CONNECT_ACCOUNT);
  }

  async completeAuthorization(): Promise<never> {
    this.refuse(CAP.IG_CONNECT_ACCOUNT);
  }

  async refreshCredentials(): Promise<never> {
    this.refuse(CAP.IG_CONNECT_ACCOUNT);
  }

  async revoke(): Promise<never> {
    this.refuse(CAP.IG_CONNECT_ACCOUNT);
  }

  async getAccountHealth(): Promise<AccountHealth> {
    this.refuse(CAP.IG_CONNECT_ACCOUNT);
  }

  verifyWebhookSignature(): boolean {
    // Returning false is the safe answer: an unverified delivery is rejected.
    // The real algorithm and header name are unconfirmed (PHASE 0, Q10).
    return false;
  }

  handleVerificationChallenge(): string | null {
    return null;
  }

  normalizeWebhook(_raw: unknown): NormalizedEvent[] {
    // The payload shape is unconfirmed (PHASE 0, Q9). Returning an empty list keeps
    // the event stored and marked unprocessed instead of inventing a translation.
    return [];
  }

  async sendMessage(): Promise<SendResult> {
    this.refuse(CAP.IG_SEND_TEXT);
  }

  async replyToComment(): Promise<SendResult> {
    this.refuse(CAP.IG_REPLY_COMMENT_PUBLIC);
  }

  async sendPrivateReply(): Promise<SendResult> {
    this.refuse(CAP.IG_SEND_PRIVATE_REPLY);
  }
}
