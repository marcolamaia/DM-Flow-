import { Injectable } from '@nestjs/common';
import {
  BUILTIN_TOKENS,
  DmFlowError,
  TRIGGER_DEFINITIONS,
  emptyGraph,
  flowGraphSchema,
  parseTriggerConfig,
  uuidv7,
  validateFlow,
  type FlowGraph,
  type TriggerType,
  type ValidationReport,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { QuotaService } from '../billing/quota.service';
import { CapabilityService } from '../capabilities/capability.service';

export interface TriggerInput {
  type: TriggerType;
  connectedAccountId?: string | null;
  config?: Record<string, unknown>;
  matchPriority?: number;
  enabled?: boolean;
}

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly capabilities: CapabilityService,
  ) {}

  async list(workspaceId: string) {
    const automations = await this.prisma.automation.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        triggers: { where: { enabled: true } },
        _count: { select: { executions: true } },
      },
    });

    return automations.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      status: a.status,
      hasUnpublishedChanges: Boolean(
        a.draftVersionId && a.draftVersionId !== a.publishedVersionId,
      ),
      triggerTypes: [...new Set(a.triggers.map((t) => t.type))],
      executionCount: a._count.executions,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
    }));
  }

  async get(workspaceId: string, automationId: string) {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: {
        draftVersion: true,
        publishedVersion: true,
        triggers: true,
      },
    });
    this.prisma.assertTenant(automation, workspaceId);

    const version = automation!.draftVersion ?? automation!.publishedVersion;
    return {
      id: automation!.id,
      name: automation!.name,
      description: automation!.description,
      status: automation!.status,
      graph: (version?.graph ?? emptyGraph()) as unknown as FlowGraph,
      schemaVersion: version?.schemaVersion ?? 1,
      draftVersionId: automation!.draftVersionId,
      publishedVersionId: automation!.publishedVersionId,
      hasUnpublishedChanges: Boolean(
        automation!.draftVersionId && automation!.draftVersionId !== automation!.publishedVersionId,
      ),
      validationReport: version?.validationReport ?? null,
      triggers: automation!.triggers.map((t) => ({
        id: t.id,
        type: t.type,
        channel: t.channel,
        connectedAccountId: t.connectedAccountId,
        config: t.config,
        matchPriority: t.matchPriority,
        enabled: t.enabled,
        definition: TRIGGER_DEFINITIONS[t.type as TriggerType] ?? null,
      })),
      updatedAt: automation!.updatedAt,
    };
  }

  async create(workspaceId: string, userId: string, name: string, description?: string) {
    await this.quota.assertCanAddAutomation(workspaceId);

    const automationId = uuidv7();
    const versionId = uuidv7();

    await this.prisma.$transaction(async (tx) => {
      await tx.automation.create({
        data: {
          id: automationId,
          workspaceId,
          name: name.trim(),
          description,
          status: 'DRAFT',
          createdById: userId,
        },
      });
      await tx.automationVersion.create({
        data: {
          id: versionId,
          workspaceId,
          automationId,
          versionNumber: 1,
          graph: emptyGraph() as never,
        },
      });
      await tx.automation.update({
        where: { id: automationId },
        data: { draftVersionId: versionId },
      });
    });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'automation.created',
      entityType: 'Automation',
      entityId: automationId,
      after: { name },
    });

    return this.get(workspaceId, automationId);
  }

  /**
   * Saves the draft graph. Never touches the published version, so editing an
   * automation cannot disturb executions already running against what is live.
   */
  async setName(
    workspaceId: string,
    userId: string,
    automationId: string,
    patch: { name?: string; description?: string },
  ) {
    const automation = await this.prisma.automation.findUnique({ where: { id: automationId } });
    this.prisma.assertTenant(automation, workspaceId);

    await this.prisma.automation.update({ where: { id: automationId }, data: patch });
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'automation.renamed',
      entityType: 'Automation',
      entityId: automationId,
      before: { name: automation!.name },
      after: patch,
    });

    return this.get(workspaceId, automationId);
  }

  async saveDraft(workspaceId: string, userId: string, automationId: string, graph: unknown) {
    const automation = await this.prisma.automation.findUnique({ where: { id: automationId } });
    this.prisma.assertTenant(automation, workspaceId);

    const parsed = flowGraphSchema.parse(graph);
    const report = await this.validate(workspaceId, automationId, parsed);

    let draftId = automation!.draftVersionId;
    if (!draftId || draftId === automation!.publishedVersionId) {
      // The published version is immutable, so a first edit after publishing
      // branches into a fresh draft rather than mutating what is live.
      const latest = await this.prisma.automationVersion.findFirst({
        where: { automationId },
        orderBy: { versionNumber: 'desc' },
      });
      draftId = uuidv7();
      await this.prisma.automationVersion.create({
        data: {
          id: draftId,
          workspaceId,
          automationId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          graph: parsed as never,
          validationReport: report as never,
        },
      });
      await this.prisma.automation.update({
        where: { id: automationId },
        data: { draftVersionId: draftId },
      });
    } else {
      await this.prisma.automationVersion.update({
        where: { id: draftId },
        data: { graph: parsed as never, validationReport: report as never },
      });
    }

    await this.prisma.automation.update({
      where: { id: automationId },
      data: { updatedAt: new Date() },
    });

    return { draftVersionId: draftId, validationReport: report };
  }

  async validate(
    workspaceId: string,
    automationId: string,
    graph: FlowGraph,
  ): Promise<ValidationReport> {
    const [triggers, tags, fields, features] = await Promise.all([
      this.prisma.trigger.findMany({ where: { automationId } }),
      this.prisma.tag.findMany({ where: { workspaceId }, select: { id: true } }),
      this.prisma.customField.findMany({ where: { workspaceId }, select: { id: true, key: true } }),
      this.quota.featuresFor(workspaceId),
    ]);

    const accountId = triggers.find((t) => t.connectedAccountId)?.connectedAccountId ?? undefined;
    const availableCapabilities = await this.capabilities.availableIds(workspaceId, accountId);

    const knownTokens = new Set<string>([
      ...BUILTIN_TOKENS,
      ...fields.map((f) => `contact.fields.${f.key}`),
    ]);

    return validateFlow(graph, {
      availableCapabilities,
      enabledFeatures: features,
      tagIds: new Set(tags.map((t) => t.id)),
      customFieldIds: new Set(fields.map((f) => f.id)),
      knownTokens,
      hasTrigger: triggers.some((t) => t.enabled),
    });
  }

  /**
   * Publishing freezes the draft. From here the version is immutable: in-flight
   * executions keep running against exactly the graph they started on.
   */
  async publish(workspaceId: string, userId: string, automationId: string) {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: { draftVersion: true },
    });
    this.prisma.assertTenant(automation, workspaceId);

    if (!automation!.draftVersion) throw new DmFlowError('FLOW_NOT_PUBLISHED');

    await this.quota.assertCanPublishAutomation(workspaceId, automationId);

    const graph = flowGraphSchema.parse(automation!.draftVersion.graph);
    const report = await this.validate(workspaceId, automationId, graph);

    if (!report.valid) {
      throw new DmFlowError('FLOW_INVALID', {
        details: report.issues.filter((i) => i.severity === 'error'),
      });
    }

    const versionId = automation!.draftVersion.id;

    await this.prisma.$transaction([
      this.prisma.automationVersion.update({
        where: { id: versionId },
        data: { publishedAt: new Date(), publishedById: userId, validationReport: report as never },
      }),
      // Triggers are re-pointed at the newly published version so matching only ever
      // finds triggers that belong to what is actually live.
      this.prisma.trigger.updateMany({
        where: { automationId },
        data: { automationVersionId: versionId },
      }),
      this.prisma.automation.update({
        where: { id: automationId },
        data: { status: 'PUBLISHED', publishedVersionId: versionId },
      }),
    ]);

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'automation.published',
      entityType: 'Automation',
      entityId: automationId,
      after: { versionId, versionNumber: automation!.draftVersion.versionNumber },
    });

    return { publishedVersionId: versionId, validationReport: report };
  }

  async setStatus(
    workspaceId: string,
    userId: string,
    automationId: string,
    status: 'PUBLISHED' | 'PAUSED' | 'ARCHIVED',
  ) {
    const automation = await this.prisma.automation.findUnique({ where: { id: automationId } });
    this.prisma.assertTenant(automation, workspaceId);

    if (status === 'PUBLISHED' && !automation!.publishedVersionId) {
      throw new DmFlowError('FLOW_NOT_PUBLISHED');
    }

    await this.prisma.automation.update({ where: { id: automationId }, data: { status } });
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: `automation.${status.toLowerCase()}`,
      entityType: 'Automation',
      entityId: automationId,
      before: { status: automation!.status },
      after: { status },
    });

    return { status };
  }

  async remove(workspaceId: string, userId: string, automationId: string) {
    const automation = await this.prisma.automation.findUnique({ where: { id: automationId } });
    this.prisma.assertTenant(automation, workspaceId);

    const running = await this.prisma.execution.count({
      where: { automationId, status: { in: ['RUNNING', 'WAITING'] } },
    });

    await this.prisma.$transaction([
      // Deleting a flow must not leave contacts stuck mid-conversation forever.
      this.prisma.execution.updateMany({
        where: { automationId, status: { in: ['RUNNING', 'WAITING'] } },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      }),
      this.prisma.automation.update({
        where: { id: automationId },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      }),
    ]);

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'automation.deleted',
      entityType: 'Automation',
      entityId: automationId,
      after: { cancelledExecutions: running },
    });

    return { ok: true, cancelledExecutions: running };
  }

  async listVersions(workspaceId: string, automationId: string) {
    const automation = await this.prisma.automation.findUnique({ where: { id: automationId } });
    this.prisma.assertTenant(automation, workspaceId);

    const versions = await this.prisma.automationVersion.findMany({
      where: { automationId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        publishedAt: true,
        publishedById: true,
        changelog: true,
        createdAt: true,
      },
    });

    return versions.map((v) => ({
      ...v,
      isPublished: v.id === automation!.publishedVersionId,
      isDraft: v.id === automation!.draftVersionId,
    }));
  }

  /** Restores an old version by copying it into a new draft — history stays intact. */
  async restoreVersion(
    workspaceId: string,
    userId: string,
    automationId: string,
    versionId: string,
  ) {
    const [automation, source] = await Promise.all([
      this.prisma.automation.findUnique({ where: { id: automationId } }),
      this.prisma.automationVersion.findUnique({ where: { id: versionId } }),
    ]);
    this.prisma.assertTenant(automation, workspaceId);
    this.prisma.assertTenant(source, workspaceId);

    if (source!.automationId !== automationId) throw new DmFlowError('NOT_FOUND');

    return this.saveDraft(workspaceId, userId, automationId, source!.graph);
  }

  // ── Triggers ───────────────────────────────────────────────

  async upsertTrigger(
    workspaceId: string,
    userId: string,
    automationId: string,
    input: TriggerInput,
    triggerId?: string,
  ) {
    const automation = await this.prisma.automation.findUnique({ where: { id: automationId } });
    this.prisma.assertTenant(automation, workspaceId);

    const definition = TRIGGER_DEFINITIONS[input.type];
    if (!definition) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'type', message: `unknown trigger type ${input.type}` }],
      });
    }

    const parsedConfig = parseTriggerConfig(input.type, input.config ?? {});
    if (!parsedConfig.success) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: parsedConfig.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // A channel trigger is only offered when its capabilities are actually usable
    // for the chosen account. Otherwise the operator builds something that can
    // never fire and only finds out when nothing happens.
    if (definition.requiredCapabilities.length > 0) {
      const available = await this.capabilities.availableIds(
        workspaceId,
        input.connectedAccountId ?? undefined,
      );
      const missing = definition.requiredCapabilities.filter((c) => !available.has(c));
      if (missing.length > 0) {
        throw new DmFlowError('CAPABILITY_NOT_VALIDATED', {
          context: { missing, triggerType: input.type },
          details: { missing },
        });
      }
    }

    if (definition.channel && !input.connectedAccountId) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'connectedAccountId', message: 'channel triggers need an account' }],
      });
    }

    if (input.connectedAccountId) {
      const account = await this.prisma.connectedAccount.findUnique({
        where: { id: input.connectedAccountId },
      });
      this.prisma.assertTenant(account, workspaceId);
    }

    const versionId = automation!.draftVersionId ?? automation!.publishedVersionId;
    if (!versionId) throw new DmFlowError('NOT_FOUND');

    const data = {
      workspaceId,
      automationId,
      automationVersionId: versionId,
      type: input.type,
      channel: definition.channel,
      connectedAccountId: input.connectedAccountId ?? null,
      config: parsedConfig.data as never,
      matchPriority: input.matchPriority ?? definition.defaultPriority,
      enabled: input.enabled ?? true,
    };

    const trigger = triggerId
      ? await this.prisma.trigger.update({ where: { id: triggerId }, data })
      : await this.prisma.trigger.create({ data: { id: uuidv7(), ...data } });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: triggerId ? 'trigger.updated' : 'trigger.created',
      entityType: 'Trigger',
      entityId: trigger.id,
      after: { type: input.type },
    });

    return trigger;
  }

  async deleteTrigger(workspaceId: string, userId: string, triggerId: string) {
    const trigger = await this.prisma.trigger.findUnique({ where: { id: triggerId } });
    this.prisma.assertTenant(trigger, workspaceId);

    await this.prisma.trigger.delete({ where: { id: triggerId } });
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'trigger.deleted',
      entityType: 'Trigger',
      entityId: triggerId,
    });
    return { ok: true };
  }

  /** Trigger catalogue for the builder, with availability resolved per account. */
  async listTriggerDefinitions(workspaceId: string, connectedAccountId?: string) {
    const available = await this.capabilities.availableIds(workspaceId, connectedAccountId);
    return Object.values(TRIGGER_DEFINITIONS).map((d) => ({
      ...d,
      available: d.requiredCapabilities.every((c) => available.has(c)),
      missingCapabilities: d.requiredCapabilities.filter((c) => !available.has(c)),
    }));
  }
}
