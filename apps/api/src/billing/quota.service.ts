import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  currentUsagePeriod,
  uuidv7,
  type PlanLimits,
  type UsageMetric,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface UsageSnapshot {
  contacts: { used: number; limit: number | null };
  automations: { used: number; limit: number | null };
  publishedAutomations: { used: number; limit: number | null };
  connectedAccounts: { used: number; limit: number | null };
  members: { used: number; limit: number | null };
  messagesPerMonth: { used: number; limit: number | null };
  executionsPerMonth: { used: number; limit: number | null };
  period: string;
}

const FALLBACK_LIMITS: PlanLimits = {
  contacts: 250,
  automations: 2,
  publishedAutomations: 1,
  connectedAccounts: 1,
  members: 1,
  messagesPerMonth: 500,
  executionsPerMonth: 500,
  historyRetentionDays: 7,
};

/**
 * Quotas are enforced here, server-side, at the moment of creation. The UI showing
 * a limit is a courtesy; this is the thing that actually holds.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async limitsFor(workspaceId: string): Promise<PlanLimits> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    if (!subscription) return FALLBACK_LIMITS;
    return { ...FALLBACK_LIMITS, ...(subscription.plan.limits as Partial<PlanLimits>) };
  }

  async featuresFor(workspaceId: string): Promise<Set<string>> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    return new Set(subscription?.plan.features ?? []);
  }

  async assertFeature(workspaceId: string, feature: string): Promise<void> {
    const features = await this.featuresFor(workspaceId);
    if (!features.has(feature)) {
      throw new DmFlowError('PLAN_LIMIT_REACHED', {
        context: { feature },
        remediation: { action: 'upgrade_plan', url: '/settings/billing' },
      });
    }
  }

  async snapshot(workspaceId: string): Promise<UsageSnapshot> {
    const limits = await this.limitsFor(workspaceId);
    const period = currentUsagePeriod();

    const [contacts, automations, published, accounts, members, counters] = await Promise.all([
      this.prisma.contact.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.automation.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.automation.count({
        where: { workspaceId, deletedAt: null, status: 'PUBLISHED' },
      }),
      this.prisma.connectedAccount.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.workspaceMember.count({ where: { workspaceId } }),
      this.prisma.usageCounter.findMany({ where: { workspaceId, period } }),
    ]);

    const counterValue = (metric: UsageMetric): number =>
      counters.find((c) => c.metric === metric)?.value ?? 0;

    return {
      contacts: { used: contacts, limit: limits.contacts },
      automations: { used: automations, limit: limits.automations },
      publishedAutomations: { used: published, limit: limits.publishedAutomations },
      connectedAccounts: { used: accounts, limit: limits.connectedAccounts },
      members: { used: members, limit: limits.members },
      messagesPerMonth: { used: counterValue('messages_sent'), limit: limits.messagesPerMonth },
      executionsPerMonth: {
        used: counterValue('executions_started'),
        limit: limits.executionsPerMonth,
      },
      period,
    };
  }

  async assertCanAddContact(workspaceId: string, count = 1): Promise<void> {
    const limits = await this.limitsFor(workspaceId);
    if (limits.contacts === null) return;
    const current = await this.prisma.contact.count({ where: { workspaceId, deletedAt: null } });
    this.enforce(current + count <= limits.contacts, 'contacts', limits.contacts, current);
  }

  async assertCanAddAutomation(workspaceId: string): Promise<void> {
    const limits = await this.limitsFor(workspaceId);
    if (limits.automations === null) return;
    const current = await this.prisma.automation.count({
      where: { workspaceId, deletedAt: null },
    });
    this.enforce(current + 1 <= limits.automations, 'automations', limits.automations, current);
  }

  async assertCanPublishAutomation(workspaceId: string, automationId: string): Promise<void> {
    const limits = await this.limitsFor(workspaceId);
    if (limits.publishedAutomations === null) return;

    // Re-publishing something already live must not consume another slot.
    const alreadyPublished = await this.prisma.automation.findFirst({
      where: { id: automationId, workspaceId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (alreadyPublished) return;

    const current = await this.prisma.automation.count({
      where: { workspaceId, deletedAt: null, status: 'PUBLISHED' },
    });
    this.enforce(
      current + 1 <= limits.publishedAutomations,
      'publishedAutomations',
      limits.publishedAutomations,
      current,
    );
  }

  async assertCanConnectAccount(workspaceId: string): Promise<void> {
    const limits = await this.limitsFor(workspaceId);
    if (limits.connectedAccounts === null) return;
    const current = await this.prisma.connectedAccount.count({
      where: { workspaceId, deletedAt: null },
    });
    this.enforce(
      current + 1 <= limits.connectedAccounts,
      'connectedAccounts',
      limits.connectedAccounts,
      current,
    );
  }

  async assertCanAddMember(workspaceId: string): Promise<void> {
    const limits = await this.limitsFor(workspaceId);
    if (limits.members === null) return;
    const current = await this.prisma.workspaceMember.count({ where: { workspaceId } });
    this.enforce(current + 1 <= limits.members, 'members', limits.members, current);
  }

  /**
   * Monthly send quota. Returns rather than throws so the engine can record a typed
   * step failure and keep the execution history honest instead of crashing.
   */
  async tryConsume(workspaceId: string, metric: UsageMetric, amount = 1): Promise<boolean> {
    const limits = await this.limitsFor(workspaceId);
    const limit =
      metric === 'messages_sent' ? limits.messagesPerMonth : limits.executionsPerMonth;

    const period = currentUsagePeriod();
    const counter = await this.prisma.usageCounter.upsert({
      where: { workspaceId_metric_period: { workspaceId, metric, period } },
      create: { id: uuidv7(), workspaceId, metric, period, value: 0 },
      update: {},
    });

    if (limit !== null && counter.value + amount > limit) return false;

    await this.prisma.usageCounter.update({
      where: { workspaceId_metric_period: { workspaceId, metric, period } },
      data: { value: { increment: amount } },
    });
    return true;
  }

  private enforce(ok: boolean, metric: string, limit: number, current: number): void {
    if (ok) return;
    throw new DmFlowError('PLAN_LIMIT_REACHED', {
      context: { metric, limit, current },
      remediation: { action: 'upgrade_plan', url: '/settings/billing' },
    });
  }
}
