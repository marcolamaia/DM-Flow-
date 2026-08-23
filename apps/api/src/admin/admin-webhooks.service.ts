import { Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { DmFlowError, monthlyCents } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { BillingService } from '../billing/billing.service';
import { StripeClient } from '../billing/stripe.client';
import { logger } from '../common/logger';
import type { PlatformRole } from '@dmflow/shared';

/** How long an unprocessed event may sit before it is a problem, not a queue. */
const STUCK_AFTER_MINUTES = 15;

export type FindingSeverity = 'error' | 'warning';

export interface ReconciliationFinding {
  code: string;
  severity: FindingSeverity;
  workspaceId: string | null;
  /** What is wrong, in words an operator can act on. */
  detail: string;
  /** What it would take to fix it. Never applied automatically. */
  suggestion: string;
}

/**
 * Whether the billing provider and the platform still agree.
 *
 * Two rules hold here. Nothing is repaired automatically — a mismatch is
 * reported with what would fix it, and a person decides, because the wrong
 * automatic repair silently bills or un-bills somebody. And when the platform
 * cannot reach Stripe at all, the report says so rather than returning zero
 * findings: "no discrepancies" and "never looked" must never render the same.
 */
@Injectable()
export class AdminWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly billing: BillingService,
    private readonly stripe: StripeClient,
  ) {}

  /**
   * Whether the events Stripe sends are actually being processed.
   *
   * A webhook pipeline that quietly stops is the failure that hurts most: money
   * keeps moving at the provider while the platform's idea of who is paying
   * freezes, and nothing looks wrong on any other screen.
   */
  async health() {
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000);

    const [total, processed, failed, pending, stuck, lastReceived, lastProcessed] = await Promise.all([
      this.prisma.stripeEvent.count(),
      this.prisma.stripeEvent.count({ where: { processedAt: { not: null } } }),
      this.prisma.stripeEvent.count({ where: { error: { not: null }, processedAt: null } }),
      this.prisma.stripeEvent.count({ where: { processedAt: null, error: null } }),
      this.prisma.stripeEvent.count({
        where: { processedAt: null, error: null, createdAt: { lt: stuckBefore } },
      }),
      this.prisma.stripeEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.stripeEvent.findFirst({
        where: { processedAt: { not: null } },
        orderBy: { processedAt: 'desc' },
        select: { processedAt: true },
      }),
    ]);

    return {
      configured: this.stripe.configured,
      total,
      processed,
      failed,
      pending,
      /** Waiting longer than a queue should ever take. */
      stuck,
      stuckAfterMinutes: STUCK_AFTER_MINUTES,
      lastReceivedAt: lastReceived?.createdAt ?? null,
      lastProcessedAt: lastProcessed?.processedAt ?? null,
    };
  }

  /**
   * Recent events, without their payloads.
   *
   * A Stripe payload carries customer names, addresses and card metadata. The
   * screen needs the type, when it arrived and whether it worked — none of which
   * requires handing an operator the whole record.
   */
  async list(query: { status?: 'failed' | 'pending' | 'processed'; type?: string; limit?: number }) {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);

    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status === 'failed' ? { error: { not: null }, processedAt: null } : {}),
      ...(query.status === 'pending' ? { processedAt: null, error: null } : {}),
      ...(query.status === 'processed' ? { processedAt: { not: null } } : {}),
    };

    const rows = await this.prisma.stripeEvent.findMany({
      where,
      select: {
        id: true,
        type: true,
        workspaceId: true,
        processedAt: true,
        error: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return rows;
  }

  /**
   * Runs a stored event through the handler again.
   *
   * Safe to repeat: the handler is written to be idempotent, and the event is
   * replayed from what Stripe actually sent rather than from anything typed
   * here. Used for the case where processing failed on a transient error and the
   * platform's state is now behind the provider's.
   */
  async reprocess(
    actor: { id: string; role: PlatformRole },
    eventId: string,
    reason: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    // Named, because the permission alone does not require a reason — replaying
    // a billing event does.
    this.audit.assertReason('admin.jobs.manage', reason, 'billing.webhook_reprocessed');

    const stored = await this.prisma.stripeEvent.findUnique({ where: { id: eventId } });
    if (!stored) throw new DmFlowError('NOT_FOUND');

    let error: string | null = null;
    try {
      await this.billing.replayStoredEvent(stored.payload as unknown as Stripe.Event);
      await this.prisma.stripeEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date(), error: null },
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 500) : String(caught);
      await this.prisma.stripeEvent.update({ where: { id: eventId }, data: { error } });
    }

    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      permission: 'admin.jobs.manage',
      action: 'billing.webhook_reprocessed',
      entityType: 'StripeEvent',
      entityId: eventId,
      workspaceId: stored.workspaceId,
      before: { error: stored.error, processedAt: stored.processedAt },
      after: { error, succeeded: error === null },
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Reported rather than thrown: the operator asked whether it works now, and
    // "it still fails, here is why" is the answer, not an error page.
    return { reprocessed: true, succeeded: error === null, error };
  }

  /**
   * Compares what the platform believes against what can be checked.
   *
   * The local checks always run — they catch the states that are wrong on their
   * own terms, with or without a provider. The provider checks run only when
   * Stripe is configured, and the report says plainly which half was skipped.
   */
  async reconcile(): Promise<{
    checkedAt: Date;
    localChecked: true;
    stripeChecked: boolean;
    /** Why the provider half did not run, when it did not. */
    stripeSkippedReason: string | null;
    findings: ReconciliationFinding[];
  }> {
    const findings: ReconciliationFinding[] = [];

    const subscriptions = await this.prisma.subscription.findMany({
      where: { workspace: { deletedAt: null } },
      include: { plan: true, workspace: { select: { id: true, name: true, status: true } } },
    });

    for (const row of subscriptions) {
      const worth = monthlyCents(row.plan.priceCents, row.plan.interval);

      // Counted in MRR, with nothing at the provider behind it. Either somebody
      // was moved by hand and Stripe was never updated, or a paying account has
      // no way to be charged again.
      if (worth > 0 && row.status === 'ACTIVE' && !row.stripeSubscriptionId) {
        findings.push({
          code: 'PAID_WITHOUT_PROVIDER',
          severity: 'error',
          workspaceId: row.workspace.id,
          detail: `${row.workspace.name} está no plano ${row.plan.code} e conta como receita, mas não tem assinatura no Stripe.`,
          suggestion:
            'Confirme se foi uma mudança feita à mão. Se o cliente deveria estar pagando, crie a assinatura no Stripe; se não, mova a conta para o plano gratuito.',
        });
      }

      // Late, with no date to count the grace period from — so the job that
      // suspends overdue workspaces will never pick it up.
      if ((row.status === 'PAST_DUE' || row.status === 'UNPAID') && !row.pastDueSince) {
        findings.push({
          code: 'PAST_DUE_WITHOUT_DATE',
          severity: 'error',
          workspaceId: row.workspace.id,
          detail: `${row.workspace.name} está em atraso sem data de início, então o prazo de tolerância nunca vence.`,
          suggestion: 'Reprocesse o webhook de falha de pagamento desta conta para restabelecer a data.',
        });
      }

      // Suspended for non-payment, yet the subscription says everything is fine.
      if (row.workspace.status === 'SUSPENDED' && row.status === 'ACTIVE') {
        findings.push({
          code: 'SUSPENDED_BUT_ACTIVE',
          severity: 'error',
          workspaceId: row.workspace.id,
          detail: `${row.workspace.name} está suspenso, mas a assinatura consta como ativa.`,
          suggestion:
            'Se o pagamento foi regularizado, reative o workspace. Se não, a assinatura precisa voltar para em atraso.',
        });
      }

      // A priced plan with no price at the provider cannot be sold at checkout.
      if (row.plan.priceCents > 0 && !row.plan.stripePriceId) {
        findings.push({
          code: 'PLAN_WITHOUT_PRICE',
          severity: 'warning',
          workspaceId: null,
          detail: `O plano ${row.plan.code} tem preço mas não tem stripePriceId, então ninguém consegue assiná-lo pelo checkout.`,
          suggestion: 'Sincronize os produtos com o Stripe antes de oferecer este plano.',
        });
      }
    }

    // Events that arrived and were never dealt with: the platform's state is
    // behind the provider's by exactly these.
    const stuck = await this.prisma.stripeEvent.count({
      where: { processedAt: null, createdAt: { lt: new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000) } },
    });
    if (stuck > 0) {
      findings.push({
        code: 'WEBHOOKS_UNPROCESSED',
        severity: 'error',
        workspaceId: null,
        detail: `${stuck} eventos do Stripe chegaram e não foram processados. Enquanto isso, o que a plataforma acha sobre quem está pagando fica desatualizado.`,
        suggestion: 'Abra a lista de webhooks, veja o erro e reprocesse.',
      });
    }

    if (!this.stripe.configured) {
      return {
        checkedAt: new Date(),
        localChecked: true,
        stripeChecked: false,
        // Said out loud. A screen that shows "nenhuma divergência" after never
        // having asked the provider is worse than one that shows nothing.
        stripeSkippedReason:
          'A cobrança não está configurada nesta instalação, então não foi possível comparar com o Stripe. Os problemas abaixo vêm apenas das verificações locais.',
        findings: dedupe(findings),
      };
    }

    try {
      await this.compareWithStripe(subscriptions, findings);
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'reconciliation could not reach Stripe',
      );
      return {
        checkedAt: new Date(),
        localChecked: true,
        stripeChecked: false,
        stripeSkippedReason:
          'Não foi possível falar com o Stripe agora. Os problemas abaixo vêm apenas das verificações locais — a comparação com o provedor não aconteceu.',
        findings: dedupe(findings),
      };
    }

    return {
      checkedAt: new Date(),
      localChecked: true,
      stripeChecked: true,
      stripeSkippedReason: null,
      findings: dedupe(findings),
    };
  }

  private async compareWithStripe(
    subscriptions: Array<{
      stripeSubscriptionId: string | null;
      status: string;
      workspace: { id: string; name: string };
      plan: { code: string; stripePriceId: string | null };
    }>,
    findings: ReconciliationFinding[],
  ): Promise<void> {
    const linked = subscriptions.filter((row) => row.stripeSubscriptionId);

    for (const row of linked) {
      const remote = await this.stripe.client.subscriptions.retrieve(row.stripeSubscriptionId!);

      const remoteActive = remote.status === 'active' || remote.status === 'trialing';
      const localActive = row.status === 'ACTIVE' || row.status === 'TRIALING';

      if (remoteActive !== localActive) {
        findings.push({
          code: 'STATUS_MISMATCH',
          severity: 'error',
          workspaceId: row.workspace.id,
          detail: `${row.workspace.name}: o Stripe diz "${remote.status}" e a plataforma diz "${row.status}".`,
          suggestion: 'Reprocesse o último webhook desta assinatura para alinhar os dois lados.',
        });
      }

      const remotePrice = remote.items.data[0]?.price.id;
      if (remotePrice && row.plan.stripePriceId && remotePrice !== row.plan.stripePriceId) {
        findings.push({
          code: 'PLAN_MISMATCH',
          severity: 'error',
          workspaceId: row.workspace.id,
          detail: `${row.workspace.name}: o Stripe cobra por um preço diferente do plano ${row.plan.code} registrado aqui.`,
          suggestion:
            'Decida qual dos dois está certo. Mudar o plano aqui não altera a cobrança; mudar no Stripe não altera o que a plataforma libera.',
        });
      }
    }
  }
}

/** One finding per problem, even when many accounts share the same cause. */
function dedupe(findings: ReconciliationFinding[]): ReconciliationFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.workspaceId ?? ''}:${finding.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
