import { Injectable } from '@nestjs/common';
import {
  AT_RISK_STATUSES,
  DEFAULT_REPORTING_TIMEZONE,
  METRIC_DEFINITIONS,
  MRR_STATUSES,
  addMoney,
  dayKey,
  dayRange,
  lifetimeValueCents,
  monthKey,
  monthlyCents,
  rate,
  startOfPeriod,
  type MoneyByCurrency,
  type Rate,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface Period {
  from: Date;
  to: Date;
  timeZone: string;
}

export interface RevenueSnapshot {
  mrr: MoneyByCurrency;
  arr: MoneyByCurrency;
  atRisk: MoneyByCurrency;
  arpa: MoneyByCurrency;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  payingSubscriptions: number;
  /** Where the numbers came from, so the interface can show it beside them. */
  asOf: Date;
}

export interface GrowthReport {
  period: { from: Date; to: Date; timeZone: string };
  signups: number;
  activatedWorkspaces: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
  logoChurn: Rate;
  revenueChurn: Rate;
  netRevenue: MoneyByCurrency;
  ltv: MoneyByCurrency;
  /** MRR at the start of the window, reconstructed from the event log. */
  openingMrr: MoneyByCurrency;
}

/**
 * Every number the admin panel is allowed to show, computed exactly once.
 *
 * The rule the whole file exists for: there is one `revenue()` and one
 * `growth()`, and every screen, export and report calls them. Nothing else in
 * the codebase sums a subscription price. The moment a second place does, the
 * dashboard and the report start disagreeing and neither one is wrong enough to
 * be obviously wrong — which is the worst kind of broken a metric can be.
 *
 * Two things are refused on principle here. Currencies are never added together,
 * because doing so needs an exchange rate nobody recorded. And a rate computed
 * from too few accounts is returned marked unreliable rather than rounded into a
 * confident-looking percentage.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The definitions themselves, so a screen can explain any figure it shows. */
  definitions() {
    return Object.values(METRIC_DEFINITIONS);
  }

  // ── Right now ──────────────────────────────────────────────

  /**
   * Recurring revenue as it stands, from the subscription table.
   *
   * Current state, not history: this answers "what are we earning" and nothing
   * about the past. Anything with a period in the question goes to `growth()`,
   * which reads the event log instead.
   */
  async revenue(): Promise<RevenueSnapshot> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: { in: [...MRR_STATUSES, ...AT_RISK_STATUSES, 'TRIALING'] as never },
        // A deleted workspace is not revenue, however its subscription row reads.
        workspace: { deletedAt: null },
      },
      include: { plan: true },
    });

    const mrr: MoneyByCurrency = {};
    const atRisk: MoneyByCurrency = {};
    let activeSubscriptions = 0;
    let trialingSubscriptions = 0;
    let payingSubscriptions = 0;

    for (const subscription of subscriptions) {
      const monthly = monthlyCents(subscription.plan.priceCents, subscription.plan.interval);
      const currency = subscription.plan.currency;

      if ((MRR_STATUSES as readonly string[]).includes(subscription.status)) {
        activeSubscriptions += 1;
        if (monthly > 0) {
          // Free-plan accounts are active customers and zero revenue. Counted as
          // accounts, excluded from the average, so ARPA is not quietly divided
          // by everyone who ever signed up.
          payingSubscriptions += 1;
          addMoney(mrr, currency, monthly);
        }
      } else if ((AT_RISK_STATUSES as readonly string[]).includes(subscription.status)) {
        if (monthly > 0) addMoney(atRisk, currency, monthly);
      } else if (subscription.status === 'TRIALING') {
        trialingSubscriptions += 1;
      }
    }

    const arr: MoneyByCurrency = {};
    const arpa: MoneyByCurrency = {};
    for (const [currency, cents] of Object.entries(mrr)) {
      arr[currency] = cents * 12;
      arpa[currency] = payingSubscriptions > 0 ? Math.round(cents / payingSubscriptions) : 0;
    }

    return {
      mrr,
      arr,
      atRisk,
      arpa,
      activeSubscriptions,
      trialingSubscriptions,
      payingSubscriptions,
      asOf: new Date(),
    };
  }

  // ── Over a period ──────────────────────────────────────────

  /**
   * What moved during a window, read from the event log.
   *
   * Deliberately not derived from the subscription table: "how many people
   * cancelled in March, and what were they worth" is a question the current
   * state cannot answer, because the row that would have told you has since been
   * changed to something else.
   */
  async growth(period: Period): Promise<GrowthReport> {
    const { from, to, timeZone } = period;

    const events = await this.prisma.domainEvent.findMany({
      where: {
        occurredAt: { gte: from, lte: to },
        event: {
          in: [
            'user.registered',
            'automation.published',
            'subscription.started',
            'subscription.reactivated',
            'subscription.cancelled',
            'payment.succeeded',
            'refund.issued',
            'chargeback.opened',
          ],
        },
      },
      select: {
        event: true,
        workspaceId: true,
        userId: true,
        amountCents: true,
        currency: true,
      },
    });

    let signups = 0;
    let newSubscriptions = 0;
    let churnedSubscriptions = 0;
    const activated = new Set<string>();
    const netRevenue: MoneyByCurrency = {};
    const churnedMrr: MoneyByCurrency = {};

    for (const event of events) {
      switch (event.event) {
        case 'user.registered':
          signups += 1;
          break;
        case 'automation.published':
          // A workspace that published five automations activated once.
          if (event.workspaceId) activated.add(event.workspaceId);
          break;
        case 'subscription.started':
        case 'subscription.reactivated':
          newSubscriptions += 1;
          break;
        case 'subscription.cancelled':
          churnedSubscriptions += 1;
          if (event.currency && event.amountCents) {
            addMoney(churnedMrr, event.currency, event.amountCents);
          }
          break;
        case 'payment.succeeded':
          if (event.currency && event.amountCents) {
            addMoney(netRevenue, event.currency, event.amountCents);
          }
          break;
        case 'refund.issued':
        case 'chargeback.opened':
          // Money that left again. Subtracted rather than reported separately, so
          // "net revenue" is net of the things that make it not revenue.
          if (event.currency && event.amountCents) {
            addMoney(netRevenue, event.currency, -Math.abs(event.amountCents));
          }
          break;
      }
    }

    const openingMrr = await this.mrrAt(from);
    const openingSubscribers = await this.subscribersAt(from);

    const logoChurn = rate(churnedSubscriptions, openingSubscribers);

    const openingTotal = Object.values(openingMrr).reduce((sum, cents) => sum + cents, 0);
    const churnedTotal = Object.values(churnedMrr).reduce((sum, cents) => sum + cents, 0);
    // Judged by the accounts behind it, not by the size of the amounts: three
    // accounts' worth of cents would otherwise clear any sample threshold.
    const revenueChurn = rate(churnedTotal, openingTotal, openingSubscribers);

    // LTV needs a monthly churn rate, so a window that is not a month has to be
    // normalised to one before dividing — otherwise a weekly report reports an
    // LTV four times too high.
    const months = Math.max((to.getTime() - from.getTime()) / (30 * 86_400_000), 1 / 30);
    const monthlyChurn: Rate = {
      ...logoChurn,
      value: logoChurn.value === null ? null : logoChurn.value / months,
    };

    const snapshot = await this.revenue();
    const ltv: MoneyByCurrency = {};
    for (const [currency, arpaCents] of Object.entries(snapshot.arpa)) {
      const value = lifetimeValueCents(arpaCents, monthlyChurn);
      if (value !== null) ltv[currency] = value;
    }

    return {
      period: { from, to, timeZone },
      signups,
      activatedWorkspaces: activated.size,
      newSubscriptions,
      churnedSubscriptions,
      logoChurn,
      revenueChurn,
      netRevenue,
      ltv,
      openingMrr,
    };
  }

  /**
   * MRR as it stood at a past instant, replayed from the event log.
   *
   * Starts from today's figure and walks the events backwards: every start since
   * then was not yet there, every cancellation since then still was. Slower than
   * reading a stored total, and correct without one — which matters more while
   * the platform is small enough not to need the stored total.
   */
  async mrrAt(instant: Date): Promise<MoneyByCurrency> {
    const now = await this.revenue();
    const since = await this.prisma.domainEvent.findMany({
      where: {
        occurredAt: { gt: instant },
        event: {
          in: [
            'subscription.started',
            'subscription.reactivated',
            'subscription.cancelled',
            'subscription.upgraded',
            'subscription.downgraded',
          ],
        },
      },
      select: { event: true, amountCents: true, currency: true },
    });

    const past: MoneyByCurrency = { ...now.mrr };
    for (const event of since) {
      if (!event.currency || !event.amountCents) continue;
      switch (event.event) {
        case 'subscription.started':
        case 'subscription.reactivated':
        case 'subscription.upgraded':
          addMoney(past, event.currency, -event.amountCents);
          break;
        case 'subscription.cancelled':
        case 'subscription.downgraded':
          addMoney(past, event.currency, event.amountCents);
          break;
      }
    }

    // A replay that lands below zero means the log is missing events — early
    // subscriptions that predate the event store, most likely. Clamped rather
    // than shown, because negative recurring revenue is not a fact about anything.
    for (const currency of Object.keys(past)) {
      if (past[currency]! < 0) past[currency] = 0;
    }
    return past;
  }

  /** How many paying subscriptions existed at a past instant, by the same replay. */
  async subscribersAt(instant: Date): Promise<number> {
    const now = await this.revenue();
    const since = await this.prisma.domainEvent.findMany({
      where: {
        occurredAt: { gt: instant },
        event: { in: ['subscription.started', 'subscription.reactivated', 'subscription.cancelled'] },
      },
      select: { event: true },
    });

    let count = now.payingSubscriptions;
    for (const event of since) {
      if (event.event === 'subscription.cancelled') count += 1;
      else count -= 1;
    }
    return Math.max(count, 0);
  }

  // ── Series ─────────────────────────────────────────────────

  /**
   * A daily series with no gaps.
   *
   * Days with nothing in them are returned as zero rather than left out: a chart
   * that skips empty days draws a flat line through a week of silence and makes
   * an outage look like steady traffic.
   */
  async series(
    event: string,
    period: Period,
  ): Promise<Array<{ day: string; count: number; amountCents: MoneyByCurrency }>> {
    const rows = await this.prisma.domainEvent.findMany({
      where: { event, occurredAt: { gte: period.from, lte: period.to } },
      select: { occurredAt: true, amountCents: true, currency: true },
    });

    const buckets = new Map<string, { count: number; amountCents: MoneyByCurrency }>();
    for (const day of dayRange(period.from, period.to, period.timeZone)) {
      buckets.set(day, { count: 0, amountCents: {} });
    }

    for (const row of rows) {
      const key = dayKey(row.occurredAt, period.timeZone);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.count += 1;
      if (row.currency && row.amountCents) addMoney(bucket.amountCents, row.currency, row.amountCents);
    }

    return [...buckets.entries()].map(([day, value]) => ({ day, ...value }));
  }

  /**
   * Retention by signup month.
   *
   * A cohort is everybody whose workspace was created in one month; retention is
   * how many of them were still doing something N months later. "Still doing
   * something" means a recorded event, not a subscription row — a paying account
   * that nobody has opened in three months is retained on paper and lost in fact.
   */
  async cohorts(monthsBack = 6, timeZone: string = DEFAULT_REPORTING_TIMEZONE) {
    const start = startOfPeriod(
      monthKey(new Date(Date.now() - monthsBack * 30 * 86_400_000), timeZone),
      timeZone,
    );

    const created = await this.prisma.domainEvent.findMany({
      where: { event: 'workspace.created', occurredAt: { gte: start } },
      select: { workspaceId: true, occurredAt: true },
    });

    const cohortOf = new Map<string, string>();
    const cohorts = new Map<string, Set<string>>();
    for (const row of created) {
      if (!row.workspaceId) continue;
      const key = monthKey(row.occurredAt, timeZone);
      cohortOf.set(row.workspaceId, key);
      if (!cohorts.has(key)) cohorts.set(key, new Set());
      cohorts.get(key)!.add(row.workspaceId);
    }

    const activity = await this.prisma.domainEvent.findMany({
      where: {
        occurredAt: { gte: start },
        workspaceId: { in: [...cohortOf.keys()] },
        event: { in: ['automation.published', 'execution.started', 'message.sent', 'user.logged_in'] },
      },
      select: { workspaceId: true, occurredAt: true },
    });

    // cohort month → offset in months → the workspaces seen active that far on
    const retained = new Map<string, Map<number, Set<string>>>();
    for (const row of activity) {
      if (!row.workspaceId) continue;
      const cohort = cohortOf.get(row.workspaceId);
      if (!cohort) continue;

      const offset = monthsBetween(cohort, monthKey(row.occurredAt, timeZone));
      if (offset < 0) continue;

      if (!retained.has(cohort)) retained.set(cohort, new Map());
      const byOffset = retained.get(cohort)!;
      if (!byOffset.has(offset)) byOffset.set(offset, new Set());
      byOffset.get(offset)!.add(row.workspaceId);
    }

    return [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, members]) => ({
        cohort: month,
        size: members.size,
        retention: Array.from({ length: monthsBack + 1 }, (_, offset) => {
          const seen = retained.get(month)?.get(offset)?.size ?? 0;
          return {
            offset,
            active: seen,
            // Reported alongside the count, never instead of it: a percentage on
            // its own hides that the cohort had four people in it.
            ratio: members.size === 0 ? null : seen / members.size,
          };
        }),
      }));
  }
}

/** Whole months between two `YYYY-MM` keys. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}
