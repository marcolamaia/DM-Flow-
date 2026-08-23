/**
 * The events the platform emits about itself.
 *
 * The admin panel is meant to be fed by what actually happens, not by counting
 * rows in whatever table happens to exist today. A count of subscribers can be
 * derived from the subscription table; "how many people cancelled in March, and
 * what was their MRR at the time" cannot — that answer only exists if the moment
 * was recorded when it happened.
 *
 * So this is an append-only log of facts, each stamped with when it happened and
 * what it was worth at that moment. Current state stays in its own tables; this
 * is the history those tables cannot reconstruct.
 */
export const DOMAIN_EVENTS = [
  // Identity
  'user.registered',
  'user.email_verified',
  'user.logged_in',
  'user.login_failed',
  'user.password_reset_requested',
  'user.password_changed',
  'user.suspended',
  'user.reactivated',
  'user.deleted',

  // Tenancy
  'workspace.created',
  'workspace.suspended',
  'workspace.reactivated',
  'member.invited',
  'member.joined',
  'member.removed',

  // Money
  'subscription.started',
  'subscription.upgraded',
  'subscription.downgraded',
  'subscription.renewed',
  'subscription.past_due',
  'subscription.cancelled',
  'subscription.reactivated',
  'payment.succeeded',
  'payment.failed',
  'refund.issued',
  'chargeback.opened',

  // Product use, which is what activation and retention are measured from
  'channel.connected',
  'channel.disconnected',
  'automation.created',
  'automation.published',
  'automation.paused',
  'automation.deleted',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'message.sent',
  'contact.created',

  // Administration
  'admin.action',
] as const;
export type DomainEventName = (typeof DOMAIN_EVENTS)[number];

export interface DomainEventInput {
  event: DomainEventName;
  /** The workspace the fact is about, when it is about one. */
  workspaceId?: string | null;
  /** The person the fact is about. */
  userId?: string | null;
  /** Who caused it, when that differs from who it is about — an admin acting. */
  actorUserId?: string | null;
  /**
   * Money involved, in the smallest unit of its currency.
   *
   * Recorded on the event rather than looked up later: a plan's price changes,
   * and a payment that happened last March was worth what it was worth then.
   */
  amountCents?: number | null;
  currency?: string | null;
  /** Anything else worth knowing. Never secrets, never full personal records. */
  properties?: Record<string, unknown>;
  /**
   * When it happened, if that is not now — used when replaying a provider's
   * webhook that describes something from an hour ago.
   */
  occurredAt?: Date;
}

/** Events that carry money and therefore feed revenue figures. */
export const REVENUE_EVENTS: ReadonlySet<DomainEventName> = new Set([
  'payment.succeeded',
  'refund.issued',
  'chargeback.opened',
]);

/**
 * Events that move the subscriber count, and in which direction.
 *
 * Kept here rather than inside the metrics layer so that the answer to "does
 * this event add or remove a subscriber" has exactly one definition, shared by
 * the dashboard and by any report.
 */
export const SUBSCRIBER_DELTA: Readonly<Partial<Record<DomainEventName, 1 | -1>>> = {
  'subscription.started': 1,
  'subscription.reactivated': 1,
  'subscription.cancelled': -1,
};
