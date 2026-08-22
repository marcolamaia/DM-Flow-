import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'dmflow:rate-limit';

export interface RateLimitOptions {
  /** Requests permitted per window, per credential. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Bucket name. Routes sharing a bucket share a budget, which is the point for
   * credential endpoints: spreading an attack across login and password reset
   * should not double the attempts available.
   */
  bucket: string;
  /**
   * How much more the address bucket allows than the credential bucket.
   *
   * The address bucket is the one an attacker cannot escape, so it can never be
   * removed — but a whole office behind one NAT is a single address, so it has
   * to be looser than the per-credential budget or ordinary use breaks. Set to 1
   * where no legitimate caller shares an address with many others.
   */
  ipMultiplier?: number;
}

/** Overrides the default budget for a route or a whole controller. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Credential endpoints. Ten attempts a minute is generous for a person and
 * useless for a password-guessing script. No multiplier: signing in is not
 * something one address does hundreds of times a minute, whoever is behind it.
 */
export const CREDENTIAL_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 60_000,
  bucket: 'credentials',
  ipMultiplier: 1,
};

/** The public API is machine traffic, so it gets a machine-shaped budget. */
export const PUBLIC_API_LIMIT: RateLimitOptions = {
  limit: 120,
  windowMs: 60_000,
  bucket: 'public-api',
};

/**
 * Inbound platform webhooks. Meta retries on failure, so throttling them creates
 * the backlog it is meant to prevent — the budget is high enough to only catch a
 * flood, and delivery is already authenticated by signature.
 */
export const WEBHOOK_LIMIT: RateLimitOptions = {
  limit: 6_000,
  windowMs: 60_000,
  bucket: 'webhook',
  ipMultiplier: 1,
};
