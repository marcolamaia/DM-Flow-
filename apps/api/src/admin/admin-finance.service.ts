import { Injectable } from '@nestjs/common';
import {
  AT_RISK_STATUSES,
  DmFlowError,
  MRR_STATUSES,
  addMoney,
  dayKey,
  dayRange,
  monthlyCents,
  platformRoleHas,
  type MoneyByCurrency,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { DomainEventsService } from './domain-events.service';
import { StripeClient } from '../billing/stripe.client';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';
import type { Period } from './metrics.service';
import type { PlatformRole } from '@dmflow/shared';

export interface PlanBreakdownRow {
  code: string;
  name: string;
  currency: string;
  /** What one account on this plan is worth per month. */
  unitCents: number;
  activeCount: number;
  atRiskCount: number;
  /** unitCents × activeCount, and nothing else. */
  mrrCents: number;
}

/**
 * Where the money is, and where it is stuck.
 *
 * Cash and recurring revenue are answered from different places on purpose. What
 * was received in a period comes from the event log, because it is a fact about
 * the past; what is recurring comes from the subscriptions, because it is a fact
 * about now. An annual invoice is one payment and twelve months of MRR, and a
 * screen that adds them together overstates both.
 */
@Injectable()
export class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly events: DomainEventsService,
    private readonly stripe: StripeClient,
  ) {}

  /** Recurring revenue split by plan, from the same normalisation as the total. */
  async byPlan(): Promise<PlanBreakdownRow[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: { in: [...MRR_STATUSES, ...AT_RISK_STATUSES] as never },
        workspace: { deletedAt: null },
      },
      include: { plan: true },
    });

    const rows = new Map<string, PlanBreakdownRow>();

    for (const subscription of subscriptions) {
      const plan = subscription.plan;
      const unitCents = monthlyCents(plan.priceCents, plan.interval);
      if (unitCents === 0) continue;

      const row =
        rows.get(plan.code) ??
        rows
          .set(plan.code, {
            code: plan.code,
            name: plan.name,
            currency: plan.currency,
            unitCents,
            activeCount: 0,
            atRiskCount: 0,
            mrrCents: 0,
          })
          .get(plan.code)!;

      if ((MRR_STATUSES as readonly string[]).includes(subscription.status)) {
        row.activeCount += 1;
        row.mrrCents += unitCents;
      } else {
        // Counted, but never added into MRR — at-risk revenue is not revenue.
        row.atRiskCount += 1;
      }
    }

    return [...rows.values()].sort((a, b) => b.mrrCents - a.mrrCents);
  }

  /**
   * Cash movements over a window, day by day.
   *
   * Read from the events, at the amount recorded on each one. Looking the amount
   * up from today's plan price would restate last March's payment at this
   * month's price.
   */
  async cashflow(period: Period) {
    const rows = await this.prisma.domainEvent.findMany({
      where: {
        occurredAt: { gte: period.from, lte: period.to },
        event: { in: ['payment.succeeded', 'payment.failed', 'refund.issued', 'chargeback.opened'] },
      },
      select: { event: true, amountCents: true, currency: true, occurredAt: true },
    });

    const received: MoneyByCurrency = {};
    const refunded: MoneyByCurrency = {};
    const chargedBack: MoneyByCurrency = {};
    const failed: MoneyByCurrency = {};
    let failedCount = 0;
    let succeededCount = 0;

    const days = new Map<string, { received: number; refunded: number; failed: number }>();
    for (const day of dayRange(period.from, period.to, period.timeZone)) {
      days.set(day, { received: 0, refunded: 0, failed: 0 });
    }

    for (const row of rows) {
      const bucket = days.get(dayKey(row.occurredAt, period.timeZone));
      const cents = row.amountCents ?? 0;
      const currency = row.currency;

      switch (row.event) {
        case 'payment.succeeded':
          succeededCount += 1;
          if (currency) addMoney(received, currency, cents);
          if (bucket) bucket.received += cents;
          break;
        case 'refund.issued':
          if (currency) addMoney(refunded, currency, Math.abs(cents));
          if (bucket) bucket.refunded += Math.abs(cents);
          break;
        case 'chargeback.opened':
          if (currency) addMoney(chargedBack, currency, Math.abs(cents));
          if (bucket) bucket.refunded += Math.abs(cents);
          break;
        case 'payment.failed':
          failedCount += 1;
          if (currency) addMoney(failed, currency, cents);
          if (bucket) bucket.failed += cents;
          break;
      }
    }

    // Net is received less what left again, per currency. Currencies with only
    // outgoing movements still appear, as a negative — hiding them would make a
    // month of refunds look like a month with nothing in it.
    const net: MoneyByCurrency = {};
    for (const [currency, cents] of Object.entries(received)) addMoney(net, currency, cents);
    for (const [currency, cents] of Object.entries(refunded)) addMoney(net, currency, -cents);
    for (const [currency, cents] of Object.entries(chargedBack)) addMoney(net, currency, -cents);

    return {
      period: { from: period.from, to: period.to, timeZone: period.timeZone },
      received,
      refunded,
      chargedBack,
      /** Amount the platform tried and failed to collect. Never counted as revenue. */
      failed,
      net,
      succeededCount,
      failedCount,
      series: [...days.entries()].map(([day, value]) => ({ day, ...value })),
    };
  }

  /**
   * Accounts the platform is currently failing to collect from.
   *
   * The list operators actually act on: who is late, since when, what the
   * provider said, and how long is left before the workspace is suspended.
   */
  async collectionProblems(role: PlatformRole) {
    const graceDays = loadEnv().BILLING_GRACE_DAYS;

    const rows = await this.prisma.subscription.findMany({
      where: {
        status: { in: [...AT_RISK_STATUSES] as never },
        workspace: { deletedAt: null },
      },
      include: {
        plan: true,
        workspace: {
          select: {
            id: true,
            name: true,
            status: true,
            members: {
              where: { role: 'OWNER' },
              select: { user: { select: { id: true, email: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { pastDueSince: 'asc' },
      take: 200,
    });

    // Asked of the permission table rather than listed by hand here: a role added
    // later would silently miss a hand-written list, and the list is exactly the
    // kind of thing that stops matching the rule it was copied from.
    const mayReadPii = platformRoleHas(role, 'admin.users.pii');

    return rows.map((row) => {
      const graceEndsAt = row.pastDueSince
        ? new Date(row.pastDueSince.getTime() + graceDays * 86_400_000)
        : null;

      return {
        workspaceId: row.workspace.id,
        workspaceName: row.workspace.name,
        workspaceStatus: row.workspace.status,
        ownerEmail: mayReadPii ? (row.workspace.members[0]?.user.email ?? null) : null,
        status: row.status,
        plan: row.plan.code,
        currency: row.plan.currency,
        monthlyCents: monthlyCents(row.plan.priceCents, row.plan.interval),
        pastDueSince: row.pastDueSince,
        // The whole point of the row: how long is left to fix it.
        graceEndsAt,
        graceDaysRemaining: graceEndsAt
          ? Math.max(0, Math.ceil((graceEndsAt.getTime() - Date.now()) / 86_400_000))
          : null,
        lastPaymentError: row.lastPaymentError,
      };
    });
  }

  /**
   * Refunds a payment.
   *
   * Refuses outright when billing is not configured. Recording a refund that no
   * money followed would put a false movement into the figures, and the figures
   * are the one thing the panel is for. A refund is real or it does not happen.
   */
  async refund(
    actor: { id: string; role: PlatformRole },
    input: { paymentIntentId: string; amountCents?: number; reason: string },
    meta: { ip?: string; userAgent?: string },
  ) {
    this.audit.assertReason('admin.billing.refund', input.reason);

    if (!this.stripe.configured) {
      throw new DmFlowError('BILLING_NOT_CONFIGURED', {
        cause: 'refusing to record a refund that no money would follow',
      });
    }

    const refund = await this.stripe.client.refunds.create({
      payment_intent: input.paymentIntentId,
      ...(input.amountCents ? { amount: input.amountCents } : {}),
      metadata: { adminUserId: actor.id, reason: input.reason.slice(0, 400) },
    });

    const workspaceId = await this.resolveWorkspaceFromCharge(refund.charge);

    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      permission: 'admin.billing.refund',
      action: 'billing.refunded',
      entityType: 'Refund',
      entityId: refund.id,
      workspaceId,
      after: { amountCents: refund.amount, currency: refund.currency, status: refund.status },
      reason: input.reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Recorded only now, with what actually moved, so net revenue reflects it.
    await this.events.record({
      event: 'refund.issued',
      workspaceId,
      actorUserId: actor.id,
      amountCents: refund.amount,
      currency: refund.currency.toUpperCase(),
      properties: { refundId: refund.id, byAdmin: true },
    });

    logger.warn(
      { adminUserId: actor.id, refundId: refund.id, amount: refund.amount },
      'refund issued by platform admin',
    );

    return { id: refund.id, amountCents: refund.amount, currency: refund.currency, status: refund.status };
  }

  private async resolveWorkspaceFromCharge(charge: unknown): Promise<string | null> {
    const chargeId = typeof charge === 'string' ? charge : null;
    if (!chargeId) return null;

    try {
      const record = await this.stripe.client.charges.retrieve(chargeId);
      const customer = typeof record.customer === 'string' ? record.customer : record.customer?.id;
      if (!customer) return null;

      const subscription = await this.prisma.subscription.findUnique({
        where: { stripeCustomerId: customer },
        select: { workspaceId: true },
      });
      return subscription?.workspaceId ?? null;
    } catch (error) {
      // Not knowing which account a refund belongs to is worth a line in the log,
      // not a failed refund — the money already moved.
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'could not resolve the workspace behind a refund',
      );
      return null;
    }
  }
}
