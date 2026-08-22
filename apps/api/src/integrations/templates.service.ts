import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  NODE_DEFINITIONS,
  flowGraphSchema,
  uuidv7,
  type FlowGraph,
  type NodeType,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { QuotaService } from '../billing/quota.service';
import { CapabilityService } from '../capabilities/capability.service';

/** Keys that must never leave a workspace inside a template. */
const FORBIDDEN_CONFIG_KEYS = [
  'accessToken',
  'refreshToken',
  'token',
  'secret',
  'apiKey',
  'password',
  'authorization',
  'connectedAccountId',
  'workspaceId',
  'contactId',
];

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly capabilities: CapabilityService,
  ) {}

  async list(workspaceId: string) {
    return this.prisma.automationTemplate.findMany({
      where: { OR: [{ workspaceId }, { visibility: 'GLOBAL' }] },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        requiredCapabilities: true,
        declaredTags: true,
        visibility: true,
        createdAt: true,
      },
    });
  }

  /**
   * Exports the automation's logic only.
   *
   * Sanitising on export is not enough on its own — the validator on import runs
   * the same check, because a template can arrive from anywhere and trusting that
   * some earlier export did the right thing is how secrets travel between tenants.
   */
  async createFromAutomation(
    workspaceId: string,
    userId: string,
    automationId: string,
    meta: { name: string; description?: string; category?: string },
  ) {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: { publishedVersion: true, draftVersion: true, triggers: true },
    });
    this.prisma.assertTenant(automation, workspaceId);

    const version = automation!.publishedVersion ?? automation!.draftVersion;
    if (!version) throw new DmFlowError('NOT_FOUND');

    const graph = flowGraphSchema.parse(version.graph);
    const { sanitized, tagIds, customFieldIds } = this.sanitize(graph);

    const [tags, fields] = await Promise.all([
      this.prisma.tag.findMany({ where: { workspaceId, id: { in: tagIds } } }),
      this.prisma.customField.findMany({ where: { workspaceId, id: { in: customFieldIds } } }),
    ]);

    const requiredCapabilities = [
      ...new Set(
        sanitized.nodes.flatMap(
          (node) => NODE_DEFINITIONS[node.type as NodeType]?.requiredCapabilities ?? [],
        ),
      ),
    ];

    // The sanitiser leaves id-shaped placeholders because it cannot query; resolve
    // them to names and keys here, so the template carries nothing workspace-local.
    const tagNameById = new Map(tags.map((t) => [t.id, t.name]));
    const fieldKeyById = new Map(fields.map((f) => [f.id, f.key]));
    const portable: FlowGraph = {
      ...sanitized,
      nodes: sanitized.nodes.map((node) => {
        const config = { ...node.config } as Record<string, unknown>;
        if (typeof config.__tagRef === 'string') {
          const name = tagNameById.get(config.__tagRef);
          if (name) config.__tagName = name;
          delete config.__tagRef;
        }
        if (typeof config.__fieldRef === 'string') {
          const key = fieldKeyById.get(config.__fieldRef);
          if (key) config.__fieldKey = key;
          delete config.__fieldRef;
        }
        return { ...node, config };
      }),
    };

    const template = await this.prisma.automationTemplate.create({
      data: {
        id: uuidv7(),
        workspaceId,
        name: meta.name.trim(),
        description: meta.description,
        category: meta.category,
        graph: portable as never,
        requiredCapabilities,
        // Tags and fields travel as names and types, never as ids from another
        // workspace, so importing recreates them locally instead of dangling.
        declaredTags: tags.map((t) => t.name),
        declaredFields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type })) as never,
        createdById: userId,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'template.created',
      entityType: 'AutomationTemplate',
      entityId: template.id,
    });

    return { id: template.id, name: template.name, requiredCapabilities };
  }

  async install(
    workspaceId: string,
    userId: string,
    templateId: string,
    options: { createMissing: boolean; connectedAccountId?: string },
  ) {
    const template = await this.prisma.automationTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new DmFlowError('NOT_FOUND');
    if (template.workspaceId && template.workspaceId !== workspaceId && template.visibility !== 'GLOBAL') {
      throw new DmFlowError('NOT_FOUND');
    }

    await this.quota.assertCanAddAutomation(workspaceId);

    // Refuse rather than install something that can never run here.
    const available = await this.capabilities.availableIds(workspaceId, options.connectedAccountId);
    const missing = template.requiredCapabilities.filter((c) => !available.has(c));
    if (missing.length > 0) {
      throw new DmFlowError('CAPABILITY_NOT_VALIDATED', {
        context: { missing },
        details: { missingCapabilities: missing },
      });
    }

    // Validate on the way in too: an imported graph is untrusted input, and a
    // template may have been hand-edited or produced by an older export.
    const graph = flowGraphSchema.parse(template.graph);
    const sanitized = this.stripSecrets(graph);

    const tagMap = new Map<string, string>();
    const fieldMap = new Map<string, string>();

    if (options.createMissing) {
      for (const name of template.declaredTags) {
        const existing = await this.prisma.tag.findUnique({
          where: { workspaceId_name: { workspaceId, name } },
        });
        const tag =
          existing ??
          (await this.prisma.tag.create({ data: { id: uuidv7(), workspaceId, name } }));
        tagMap.set(name, tag.id);
      }

      const declaredFields = (template.declaredFields ?? []) as Array<{
        key: string;
        label: string;
        type: string;
      }>;
      for (const field of declaredFields) {
        const existing = await this.prisma.customField.findUnique({
          where: { workspaceId_key: { workspaceId, key: field.key } },
        });
        const created =
          existing ??
          (await this.prisma.customField.create({
            data: {
              id: uuidv7(),
              workspaceId,
              key: field.key,
              label: field.label,
              type: field.type as never,
            },
          }));
        fieldMap.set(field.key, created.id);
      }
    }

    // Rebind placeholders to the ids that exist in THIS workspace.
    const rebound = {
      ...sanitized,
      nodes: sanitized.nodes.map((node) => {
        const config = { ...node.config } as Record<string, unknown>;
        if (typeof config.__tagName === 'string') {
          config.tagId = tagMap.get(config.__tagName) ?? '';
          delete config.__tagName;
        }
        if (typeof config.__fieldKey === 'string') {
          config.customFieldId = fieldMap.get(config.__fieldKey) ?? '';
          delete config.__fieldKey;
        }
        return { ...node, config };
      }),
    };

    const automationId = uuidv7();
    const versionId = uuidv7();

    await this.prisma.$transaction(async (tx) => {
      await tx.automation.create({
        data: {
          id: automationId,
          workspaceId,
          name: template.name,
          description: template.description,
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
          graph: rebound as never,
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
      action: 'template.installed',
      entityType: 'Automation',
      entityId: automationId,
      after: { templateId },
    });

    // Imported as a draft on purpose: the operator reviews and publishes.
    return { automationId, status: 'DRAFT' };
  }

  /**
   * Import-side guard: removes anything credential-shaped without touching the
   * portable placeholders that the rebinding step needs.
   */
  private stripSecrets(graph: FlowGraph): FlowGraph {
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const config: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node.config ?? {})) {
          const lowered = key.toLowerCase();
          if (FORBIDDEN_CONFIG_KEYS.some((forbidden) => lowered.includes(forbidden.toLowerCase()))) {
            continue;
          }
          if (key === 'headers' || key === 'assigneeId') continue;
          config[key] = value;
        }
        return { ...node, config };
      }),
    };
  }

  /**
   * Export-side: strips credentials and cross-workspace ids, and marks tag and
   * field references so the caller can turn them into portable names.
   */
  private sanitize(graph: FlowGraph): {
    sanitized: FlowGraph;
    tagIds: string[];
    customFieldIds: string[];
  } {
    const tagIds: string[] = [];
    const customFieldIds: string[] = [];

    const nodes = graph.nodes.map((node) => {
      const config: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(node.config ?? {})) {
        if (FORBIDDEN_CONFIG_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden.toLowerCase()))) {
          continue;
        }
        if (key === 'tagId' && typeof value === 'string') {
          tagIds.push(value);
          // Resolved to the tag's name by the caller, which can query.
          config.__tagRef = value;
          continue;
        }
        if (key === 'customFieldId' && typeof value === 'string') {
          customFieldIds.push(value);
          config.__fieldRef = value;
          continue;
        }
        if (key === 'headers' && value && typeof value === 'object') {
          // Headers commonly carry an Authorization value; drop them entirely
          // rather than trying to guess which ones are safe.
          continue;
        }
        if (key === 'assigneeId') continue;
        config[key] = value;
      }

      return { ...node, config };
    });

    return {
      sanitized: { ...graph, nodes },
      tagIds: [...new Set(tagIds)],
      customFieldIds: [...new Set(customFieldIds)],
    };
  }
}
