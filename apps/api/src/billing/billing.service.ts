import { Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { DmFlowError, monthlyCents } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StripeClient } from './stripe.client';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';
import { DomainEventsService } from '../admin/domain-events.service';

type StripeStatus = Stripe.Subscription.Status;

/** What a subscription was worth at one moment, for comparing against another. */
interface SubscriptionSnapshot {
  status: string;
  planCode: string;
  currency: string;
  monthlyCents: number;
}

const STATUS_MAP: Record<string, string> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'INCOMPLETE_EXPIRED',
  unpaid: 'UNPAID',
  paused: 'PAUSED',
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { sortOrder: 'asc' },
    });
    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      interval: p.interval,
      limits: p.limits,
      features: p.features,
    }));
  }

  async getSubscription(workspaceId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });

    if (!subscription) return null;

    const graceDays = loadEnv().BILLING_GRACE_DAYS;
    const graceEndsAt = subscription.pastDueSince
      ? new Date(subscription.pastDueSince.getTime() + graceDays * 86_400_000)
      : null;

    return {
      status: subscription.status,
      plan: {
        code: subscription.plan.code,
        name: subscription.plan.name,
        priceCents: subscription.plan.priceCents,
        currency: subscription.plan.currency,
        features: subscription.plan.features,
        limits: subscription.plan.limits,
      },
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      lastPaymentError: subscription.lastPaymentError,
      pastDueSince: subscription.pastDueSince,
      // The operator should always know exactly how long they have to fix a payment.
      graceEndsAt,
      graceDaysRemaining: graceEndsAt
        ? Math.max(0, Math.ceil((graceEndsAt.getTime() - Date.now()) / 86_400_000))
        : null,
      workspaceStatus: workspace?.status ?? 'ACTIVE',
      suspensionReason: workspace?.suspensionReason ?? null,
      billingConfigured: this.stripe.configured,
    };
  }

  async createCheckout(workspaceId: string, userId: string, planCode: string) {
    const [plan, workspace, user] = await Promise.all([
      this.prisma.plan.findUnique({ where: { code: planCode } }),
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!plan || !workspace || !user) throw new DmFlowError('NOT_FOUND');

    // Downgrading to Free is a local change; there is nothing to charge.
    if (plan.priceCents === 0) {
      await this.applyPlan(workspaceId, plan.id, 'ACTIVE');
      await this.audit.record({
        workspaceId,
        actorUserId: userId,
        action: 'billing.plan_changed',
        after: { plan: plan.code },
      });
      return { mode: 'applied' as const, planCode: plan.code };
    }

    if (!this.stripe.configured) {
      // Local mode: apply the plan so the whole product can be exercised without
      // card details, and say plainly that nothing was charged.
      await this.applyPlan(workspaceId, plan.id, 'ACTIVE');
      await this.audit.record({
        workspaceId,
        actorUserId: userId,
        action: 'billing.plan_changed_local_mode',
        after: { plan: plan.code },
      });
      return {
        mode: 'local' as const,
        planCode: plan.code,
        notice: {
          'pt-BR':
            'A cobrança não está configurada nesta instalação. O plano foi aplicado localmente e nenhum pagamento foi processado.',
          en: 'Billing is not configured on this installation. The plan was applied locally and no payment was processed.',
        },
      };
    }

    if (!plan.stripePriceId) {
      throw new DmFlowError('BILLING_NOT_CONFIGURED', {
        context: { planCode },
        cause: 'plan has no stripePriceId; run the Stripe product sync first',
      });
    }

    const customerId = await this.ensureCustomer(workspaceId, workspace.name, user.email);
    const env = loadEnv();

    const session = await this.stripe.client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${env.WEB_URL}/settings/billing?checkout=success`,
      cancel_url: `${env.WEB_URL}/settings/billing?checkout=cancelled`,
      // The workspace travels with the session so the webhook can bind the result
      // without trusting anything the browser sends back.
      client_reference_id: workspaceId,
      subscription_data: { metadata: { workspaceId, planId: plan.id } },
      metadata: { workspaceId, planId: plan.id },
    });

    return { mode: 'checkout' as const, url: session.url, sessionId: session.id };
  }

  async createPortalSession(workspaceId: string) {
    if (!this.stripe.configured) {
      throw new DmFlowError('BILLING_NOT_CONFIGURED');
    }

    const subscription = await this.prisma.subscription.findUnique({ where: { workspaceId } });
    if (!subscription?.stripeCustomerId) {
      throw new DmFlowError('BILLING_NOT_CONFIGURED', {
        context: { reason: 'no_stripe_customer' },
      });
    }

    const session = await this.stripe.client.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: loadEnv().STRIPE_PORTAL_RETURN_URL,
    });

    return { url: session.url };
  }

  // ── Webhook ────────────────────────────────────────────────

  /**
   * Stripe events are recorded before they are acted on and keyed by Stripe's own
   * event id, so a redelivery cannot apply the same change twice — which for
   * billing means a double upgrade or a wrongly repeated suspension.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    const env = loadEnv();
    if (!this.stripe.configured || !env.STRIPE_WEBHOOK_SECRET) {
      throw new DmFlowError('BILLING_NOT_CONFIGURED');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'stripe signature verification failed');
      throw new DmFlowError('STRIPE_SIGNATURE_INVALID');
    }

    const existing = await this.prisma.stripeEvent.findUnique({ where: { id: event.id } });
    if (existing?.processedAt) return { received: true };

    await this.prisma.stripeEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, type: event.type, payload: event as never },
      update: {},
    });

    try {
      await this.applyEvent(event);
      await this.prisma.stripeEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      await this.prisma.stripeEvent.update({
        where: { id: event.id },
        data: { error: (error as Error).message.slice(0, 500) },
      });
      throw error;
    }

    return { received: true };
  }

  /**
   * Runs a stored event through the handler again.
   *
   * Exposed for the administrative reprocess button, and deliberately narrow: it
   * takes an event the platform already received and verified, never anything
   * assembled by a caller. Safe to repeat because every branch of the handler
   * writes the state Stripe describes rather than incrementing anything.
   */
  async replayStoredEvent(event: Stripe.Event): Promise<void> {
    await this.applyEvent(event);
  }

  private async applyEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.client_reference_id ?? session.metadata?.workspaceId;
        if (!workspaceId) return;

        await this.prisma.subscription.update({
          where: { workspaceId },
          data: {
            stripeCustomerId:
              typeof session.customer === 'string' ? session.customer : session.customer?.id,
            stripeSubscriptionId:
              typeof session.subscription === 'string'
                ? session.subscription
                : session.subscription?.id,
          },
        });
        return;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await this.syncSubscription(sub);
        return;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const workspaceId = await this.resolveWorkspace(sub);
        if (!workspaceId) return;

        const before = await this.snapshot(workspaceId);
        const freePlan = await this.prisma.plan.findUnique({ where: { code: 'free' } });
        if (freePlan) await this.applyPlan(workspaceId, freePlan.id, 'CANCELED');
        await this.recordSubscriptionChange(workspaceId, before, await this.snapshot(workspaceId));

        // Cancellation drops to Free rather than suspending: the customer stopped
        // paying, they did not fail to pay. Their data and a working free tier stay.
        await this.setWorkspaceStatus(workspaceId, 'ACTIVE', null);
        await this.audit.record({
          workspaceId,
          actorType: 'SYSTEM',
          action: 'billing.subscription_cancelled',
        });
        return;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const workspaceId = await this.resolveWorkspaceByCustomer(invoice.customer);
        if (!workspaceId) return;

        const reason =
          invoice.last_finalization_error?.message ??
          'O pagamento da assinatura não foi concluído.';

        const before = await this.snapshot(workspaceId);
        await this.prisma.subscription.update({
          where: { workspaceId },
          data: {
            status: 'PAST_DUE',
            lastPaymentError: reason.slice(0, 300),
            pastDueSince: new Date(),
          },
        });
        await this.recordSubscriptionChange(workspaceId, before, await this.snapshot(workspaceId));
        await this.events.record({
          event: 'payment.failed',
          workspaceId,
          amountCents: invoice.amount_due ?? null,
          currency: invoice.currency?.toUpperCase() ?? null,
          properties: { reason: reason.slice(0, 300) },
        });

        // Grace first: the workspace keeps working while the customer fixes the card.
        await this.setWorkspaceStatus(workspaceId, 'PAST_DUE', 'payment_failed');
        await this.audit.record({
          workspaceId,
          actorType: 'SYSTEM',
          action: 'billing.payment_failed',
          after: { reason },
        });
        return;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const workspaceId = await this.resolveWorkspaceByCustomer(invoice.customer);
        if (!workspaceId) return;

        const before = await this.snapshot(workspaceId);
        await this.prisma.subscription.update({
          where: { workspaceId },
          data: { status: 'ACTIVE', lastPaymentError: null, pastDueSince: null },
        });
        await this.recordSubscriptionChange(workspaceId, before, await this.snapshot(workspaceId));

        // Cash actually received, in the currency Stripe charged it in. Separate
        // from MRR on purpose: an annual invoice is one payment and twelve months
        // of recurring revenue, and conflating them overstates both.
        await this.events.record({
          event: 'payment.succeeded',
          workspaceId,
          amountCents: invoice.amount_paid ?? null,
          currency: invoice.currency?.toUpperCase() ?? null,
          properties: { invoiceId: invoice.id },
        });
        await this.reactivate(workspaceId, 'payment_succeeded');
        return;
      }

      default:
        logger.debug({ type: event.type }, 'unhandled stripe event');
    }
  }

  private async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const workspaceId = await this.resolveWorkspace(sub);
    if (!workspaceId) return;

    const before = await this.snapshot(workspaceId);

    const priceId = sub.items.data[0]?.price.id;
    const plan = priceId
      ? await this.prisma.plan.findFirst({ where: { stripePriceId: priceId } })
      : null;

    const status = STATUS_MAP[sub.status as StripeStatus] ?? 'ACTIVE';
    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
    const periodStart = (sub as unknown as { current_period_start?: number }).current_period_start;

    await this.prisma.subscription.update({
      where: { workspaceId },
      data: {
        ...(plan ? { planId: plan.id } : {}),
        status: status as never,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      },
    });

    await this.recordSubscriptionChange(workspaceId, before, await this.snapshot(workspaceId));

    if (status === 'ACTIVE' || status === 'TRIALING') {
      await this.reactivate(workspaceId, 'subscription_active');
    }
  }

  /**
   * Suspension is the last step, never the first. Called by the scheduler once the
   * grace period has genuinely elapsed.
   */
  async suspendOverdueWorkspaces(): Promise<number> {
    const graceDays = loadEnv().BILLING_GRACE_DAYS;
    const cutoff = new Date(Date.now() - graceDays * 86_400_000);

    const overdue = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['PAST_DUE', 'UNPAID'] },
        pastDueSince: { not: null, lte: cutoff },
        workspace: { status: { not: 'SUSPENDED' } },
      },
      select: { workspaceId: true },
    });

    for (const { workspaceId } of overdue) {
      await this.setWorkspaceStatus(workspaceId, 'SUSPENDED', 'payment_overdue');
      // Running automations stop rather than dying one failed step at a time.
      await this.prisma.execution.updateMany({
        where: { workspaceId, status: { in: ['RUNNING', 'WAITING'] } },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
      await this.audit.record({
        workspaceId,
        actorType: 'SYSTEM',
        action: 'billing.workspace_suspended',
        after: { graceDays },
      });
      logger.warn({ workspaceId, graceDays }, 'workspace suspended for non-payment');
    }

    return overdue.length;
  }

  /**
   * What a subscription was worth, at the moment we look at it.
   *
   * Read before and after every change, because the panel's questions are about
   * movement — started, upgraded, cancelled — and movement is a difference
   * between two snapshots, not a state.
   */
  private async snapshot(workspaceId: string): Promise<SubscriptionSnapshot | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    if (!row) return null;

    return {
      status: row.status,
      planCode: row.plan.code,
      currency: row.plan.currency,
      monthlyCents: monthlyCents(row.plan.priceCents, row.plan.interval),
    };
  }

  /**
   * Turns a before/after pair into the facts the metrics layer reads.
   *
   * One definition of what counts as starting, upgrading and cancelling, used by
   * every path that can change a subscription. Written here rather than repeated
   * at each Stripe event, because the day the two disagree is the day MRR and
   * churn stop adding up to each other.
   */
  private async recordSubscriptionChange(
    workspaceId: string,
    before: SubscriptionSnapshot | null,
    after: SubscriptionSnapshot | null,
  ): Promise<void> {
    if (!after) return;

    const was = before?.monthlyCents ?? 0;
    const now = after.monthlyCents;
    const currency = after.currency;
    const properties = { from: before?.planCode ?? null, to: after.planCode };

    if (was === 0 && now > 0) {
      await this.events.record({
        event: 'subscription.started',
        workspaceId,
        amountCents: now,
        currency,
        properties,
      });
    } else if (was > 0 && now === 0) {
      // Worth what it was worth when it ended, not what the plan costs today.
      await this.events.record({
        event: 'subscription.cancelled',
        workspaceId,
        amountCents: was,
        currency: before?.currency ?? currency,
        properties,
      });
    } else if (now > was) {
      await this.events.record({
        event: 'subscription.upgraded',
        workspaceId,
        amountCents: now - was,
        currency,
        properties,
      });
    } else if (now < was) {
      await this.events.record({
        event: 'subscription.downgraded',
        workspaceId,
        amountCents: was - now,
        currency,
        properties,
      });
    }

    // A status move is a separate fact from a price move: going past due changes
    // nothing about the plan, and the panel needs to see it anyway.
    const stopped = before && before.status === 'ACTIVE' && after.status !== 'ACTIVE';
    const resumed = before && before.status !== 'ACTIVE' && after.status === 'ACTIVE';

    if (stopped && (after.status === 'PAST_DUE' || after.status === 'UNPAID')) {
      await this.events.record({
        event: 'subscription.past_due',
        workspaceId,
        amountCents: now,
        currency,
      });
    } else if (resumed && before.status !== 'TRIALING' && now > 0) {
      await this.events.record({
        event: 'subscription.reactivated',
        workspaceId,
        amountCents: now,
        currency,
      });
    }
  }

  private async reactivate(workspaceId: string, reason: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace || workspace.status === 'ACTIVE') return;

    await this.setWorkspaceStatus(workspaceId, 'ACTIVE', null);
    await this.audit.record({
      workspaceId,
      actorType: 'SYSTEM',
      action: 'billing.workspace_reactivated',
      after: { reason },
    });
    logger.info({ workspaceId, reason }, 'workspace reactivated');
  }

  private async setWorkspaceStatus(
    workspaceId: string,
    status: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED',
    reason: string | null,
  ): Promise<void> {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status,
        suspensionReason: reason,
        suspendedAt: status === 'SUSPENDED' ? new Date() : null,
      },
    });
  }

  private async applyPlan(workspaceId: string, planId: string, status: string): Promise<void> {
    await this.prisma.subscription.update({
      where: { workspaceId },
      data: { planId, status: status as never, lastPaymentError: null, pastDueSince: null },
    });
  }

  private async ensureCustomer(
    workspaceId: string,
    workspaceName: string,
    email: string,
  ): Promise<string> {
    const subscription = await this.prisma.subscription.findUnique({ where: { workspaceId } });
    if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await this.stripe.client.customers.create({
      email,
      name: workspaceName,
      metadata: { workspaceId },
    });

    await this.prisma.subscription.update({
      where: { workspaceId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  private async resolveWorkspace(sub: Stripe.Subscription): Promise<string | null> {
    if (sub.metadata?.workspaceId) return sub.metadata.workspaceId;

    const bySubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
      select: { workspaceId: true },
    });
    if (bySubscription) return bySubscription.workspaceId;

    return this.resolveWorkspaceByCustomer(sub.customer);
  }

  private async resolveWorkspaceByCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ): Promise<string | null> {
    const id = typeof customer === 'string' ? customer : customer?.id;
    if (!id) return null;

    const record = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId: id },
      select: { workspaceId: true },
    });
    return record?.workspaceId ?? null;
  }
}
