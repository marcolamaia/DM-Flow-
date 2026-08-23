import { Injectable } from '@nestjs/common';
import { DmFlowError, monthlyCents, platformRoleHas, type PlatformRole } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { DomainEventsService } from './domain-events.service';

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface SubscriptionQuery {
  status?: string;
  plan?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

/**
 * The paying side of the platform, account by account.
 *
 * Every row reports its contribution through the same normalisation the metrics
 * layer uses, so a list that is filtered down to one plan adds up to what the
 * overview says that plan is worth. A second way of computing it here would be
 * the exact drift the metrics layer exists to prevent.
 */
@Injectable()
export class AdminSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly events: DomainEventsService,
  ) {}

  async list(role: PlatformRole, query: SubscriptionQuery) {
    const take = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const search = query.search?.trim();
    const mayReadPii = platformRoleHas(role, 'admin.users.pii');

    const rows = await this.prisma.subscription.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.plan ? { plan: { code: query.plan } } : {}),
        ...(search ? { workspace: { name: { contains: search, mode: 'insensitive' } } } : {}),
        workspace: {
          deletedAt: null,
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
      },
      include: {
        plan: true,
        workspace: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            members: {
              where: { role: 'OWNER' },
              select: { user: { select: { id: true, email: true, name: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, take);
    return {
      subscriptions: page.map((row) => {
        const owner = row.workspace.members[0]?.user;
        return {
          id: row.id,
          status: row.status,
          workspace: {
            id: row.workspace.id,
            name: row.workspace.name,
            status: row.workspace.status,
            createdAt: row.workspace.createdAt,
          },
          owner: owner
            ? {
                id: owner.id,
                // Same rule as the customer list: the account is visible, the
                // person behind it needs its own permission.
                email: mayReadPii ? owner.email : null,
                name: mayReadPii ? owner.name : null,
              }
            : null,
          plan: { code: row.plan.code, name: row.plan.name },
          currency: row.plan.currency,
          monthlyCents: monthlyCents(row.plan.priceCents, row.plan.interval),
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          pastDueSince: row.pastDueSince,
          // Present for support to read back; never the raw provider payload.
          lastPaymentError: row.lastPaymentError,
          // Whether this account is wired to Stripe at all, without exposing the
          // identifiers themselves.
          billingLinked: Boolean(row.stripeSubscriptionId),
          createdAt: row.createdAt,
        };
      }),
      nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
    };
  }

  /**
   * Moves an account onto another plan by hand.
   *
   * For the cases a self-service checkout cannot cover — a negotiated price, an
   * apology, a migration. It does not touch Stripe: changing what the customer
   * is charged happens at the provider, and pretending otherwise here would put
   * the two out of step silently. What it changes is what the platform grants,
   * and it says so.
   */
  async changePlan(
    actor: { id: string; role: PlatformRole },
    workspaceId: string,
    planCode: string,
    reason: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    this.audit.assertReason('admin.subscriptions.write', reason);

    const [subscription, plan] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { workspaceId },
        include: { plan: true },
      }),
      this.prisma.plan.findUnique({ where: { code: planCode } }),
    ]);

    if (!subscription) throw new DmFlowError('NOT_FOUND');
    if (!plan) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'planCode', message: 'Este plano não existe.' }],
      });
    }

    const wasWorth = monthlyCents(subscription.plan.priceCents, subscription.plan.interval);
    const nowWorth = monthlyCents(plan.priceCents, plan.interval);

    await this.prisma.subscription.update({
      where: { workspaceId },
      data: { planId: plan.id },
    });

    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      permission: 'admin.subscriptions.write',
      action: 'subscription.plan_changed_by_admin',
      entityType: 'Subscription',
      entityId: subscription.id,
      workspaceId,
      before: { plan: subscription.plan.code, monthlyCents: wasWorth },
      after: { plan: plan.code, monthlyCents: nowWorth },
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Recorded with what changed in recurring terms, so the movement lands in
    // the same figures a customer-initiated change would.
    if (nowWorth !== wasWorth) {
      await this.events.record({
        event: nowWorth > wasWorth ? 'subscription.upgraded' : 'subscription.downgraded',
        workspaceId,
        actorUserId: actor.id,
        amountCents: Math.abs(nowWorth - wasWorth),
        currency: plan.currency,
        properties: { from: subscription.plan.code, to: plan.code, byAdmin: true },
      });
    }

    return {
      plan: plan.code,
      monthlyCents: nowWorth,
      // Said out loud rather than assumed: the platform's grant moved, the
      // provider's charge did not.
      notice: {
        'pt-BR':
          'O plano foi alterado na plataforma. A cobrança no Stripe não foi modificada — ajuste-a lá se o valor cobrado também precisa mudar.',
        en: 'The plan changed on the platform. The Stripe charge was not modified — adjust it there if the amount billed also needs to change.',
      },
    };
  }
}
