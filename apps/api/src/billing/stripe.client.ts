import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';

/**
 * Wraps the Stripe SDK so the rest of the app never has to care whether billing is
 * configured. With no secret key the platform still runs completely — plans,
 * quotas, suspension and reactivation all work — and checkout returns a simulated
 * session instead of failing. That matters because a self-hosted or pre-launch
 * install should not be bricked by a missing key.
 */
@Injectable()
export class StripeClient {
  private readonly stripe: Stripe | null;

  constructor() {
    const env = loadEnv();
    this.stripe = env.STRIPE_SECRET_KEY
      ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as never })
      : null;

    if (!this.stripe) {
      logger.warn(
        'STRIPE_SECRET_KEY is not set — billing runs in local mode: plans and quotas ' +
          'are enforced, checkout is simulated, and no card is ever charged.',
      );
    }
  }

  get configured(): boolean {
    return this.stripe !== null;
  }

  get client(): Stripe {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe;
  }

  /** Verifies the webhook signature on raw bytes. Never trusts a parsed body. */
  constructEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event {
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }
}
