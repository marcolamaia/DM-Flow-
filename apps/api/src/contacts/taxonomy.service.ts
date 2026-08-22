import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  collectPredicateReferences,
  predicateSchema,
  uuidv7,
  type CustomFieldType,
  type PredicateNode,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { compilePredicate } from './predicate-sql';

/** Tags, custom fields and segments: the vocabulary a workspace segments by. */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Tags ───────────────────────────────────────────────────

  async listTags(workspaceId: string) {
    const tags = await this.prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      description: t.description,
      contactCount: t._count.contacts,
      createdAt: t.createdAt,
    }));
  }

  async createTag(
    workspaceId: string,
    actorId: string,
    input: { name: string; color?: string; description?: string },
  ) {
    const tag = await this.prisma.tag.create({
      data: {
        id: uuidv7(),
        workspaceId,
        name: input.name.trim(),
        color: input.color ?? '#6366f1',
        description: input.description,
      },
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'tag.created',
      entityType: 'Tag',
      entityId: tag.id,
      after: { name: tag.name },
    });
    return tag;
  }

  async updateTag(
    workspaceId: string,
    actorId: string,
    tagId: string,
    patch: { name?: string; color?: string; description?: string },
  ) {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    this.prisma.assertTenant(tag, workspaceId);

    const updated = await this.prisma.tag.update({ where: { id: tagId }, data: patch });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'tag.updated',
      entityType: 'Tag',
      entityId: tagId,
      before: { name: tag!.name },
      after: patch,
    });
    return updated;
  }

  /**
   * Deleting a tag that a published automation depends on would break that flow at
   * run time with no warning, so the delete is refused and names what is using it.
   */
  async deleteTag(workspaceId: string, actorId: string, tagId: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    this.prisma.assertTenant(tag, workspaceId);

    const dependents = await this.findAutomationsReferencing(workspaceId, tagId);
    if (dependents.length > 0) {
      throw new DmFlowError('ALREADY_EXISTS', {
        context: { reason: 'tag_in_use', automations: dependents },
        details: { automations: dependents },
      });
    }

    await this.prisma.tag.delete({ where: { id: tagId } });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'tag.deleted',
      entityType: 'Tag',
      entityId: tagId,
      before: { name: tag!.name },
    });
    return { ok: true };
  }

  // ── Custom fields ──────────────────────────────────────────

  async listCustomFields(workspaceId: string) {
    return this.prisma.customField.findMany({
      where: { workspaceId },
      orderBy: { label: 'asc' },
    });
  }

  async createCustomField(
    workspaceId: string,
    actorId: string,
    input: { key: string; label: string; type: CustomFieldType; options?: string[] },
  ) {
    const key = input.key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 60);

    if (!key) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'key', message: 'key must contain letters or numbers' }],
      });
    }

    const field = await this.prisma.customField.create({
      data: {
        id: uuidv7(),
        workspaceId,
        key,
        label: input.label.trim(),
        type: input.type,
        options: input.options ? (input.options as never) : undefined,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'custom_field.created',
      entityType: 'CustomField',
      entityId: field.id,
      after: { key, type: input.type },
    });
    return field;
  }

  async deleteCustomField(workspaceId: string, actorId: string, fieldId: string) {
    const field = await this.prisma.customField.findUnique({ where: { id: fieldId } });
    this.prisma.assertTenant(field, workspaceId);

    const dependents = await this.findAutomationsReferencing(workspaceId, fieldId);
    if (dependents.length > 0) {
      throw new DmFlowError('ALREADY_EXISTS', {
        context: { reason: 'custom_field_in_use', automations: dependents },
        details: { automations: dependents },
      });
    }

    await this.prisma.customField.delete({ where: { id: fieldId } });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'custom_field.deleted',
      entityType: 'CustomField',
      entityId: fieldId,
      before: { key: field!.key },
    });
    return { ok: true };
  }

  // ── Segments ───────────────────────────────────────────────

  async listSegments(workspaceId: string) {
    const segments = await this.prisma.segment.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
    return segments;
  }

  async createSegment(
    workspaceId: string,
    actorId: string,
    input: { name: string; description?: string; filter: PredicateNode },
  ) {
    await this.assertPredicateReferencesExist(workspaceId, input.filter);
    // Compile once at save time so a broken segment is rejected here rather than
    // failing later inside somebody's contact list.
    compilePredicate(input.filter);

    const segment = await this.prisma.segment.create({
      data: {
        id: uuidv7(),
        workspaceId,
        name: input.name.trim(),
        description: input.description,
        filter: input.filter as never,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'segment.created',
      entityType: 'Segment',
      entityId: segment.id,
      after: { name: segment.name },
    });
    return segment;
  }

  async updateSegment(
    workspaceId: string,
    actorId: string,
    segmentId: string,
    patch: { name?: string; description?: string; filter?: PredicateNode },
  ) {
    const segment = await this.prisma.segment.findUnique({ where: { id: segmentId } });
    this.prisma.assertTenant(segment, workspaceId);

    if (patch.filter) {
      await this.assertPredicateReferencesExist(workspaceId, patch.filter);
      compilePredicate(patch.filter);
    }

    const updated = await this.prisma.segment.update({
      where: { id: segmentId },
      data: {
        name: patch.name,
        description: patch.description,
        filter: patch.filter ? (patch.filter as never) : undefined,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'segment.updated',
      entityType: 'Segment',
      entityId: segmentId,
    });
    return updated;
  }

  async deleteSegment(workspaceId: string, actorId: string, segmentId: string) {
    const segment = await this.prisma.segment.findUnique({ where: { id: segmentId } });
    this.prisma.assertTenant(segment, workspaceId);

    await this.prisma.segment.delete({ where: { id: segmentId } });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'segment.deleted',
      entityType: 'Segment',
      entityId: segmentId,
    });
    return { ok: true };
  }

  /** Live count for a segment, so the operator sees its size before using it. */
  async countSegment(workspaceId: string, filter: PredicateNode): Promise<number> {
    const compiled = compilePredicate(filter);
    const shifted = compiled.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + 1}`);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "Contact" c
       WHERE c."workspaceId" = $1 AND c."deletedAt" IS NULL AND (${shifted})`,
      workspaceId,
      ...compiled.params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async assertPredicateReferencesExist(
    workspaceId: string,
    filter: PredicateNode,
  ): Promise<void> {
    const parsed = predicateSchema.parse(filter);
    const refs = collectPredicateReferences(parsed);

    if (refs.tagIds.length > 0) {
      const found = await this.prisma.tag.count({
        where: { workspaceId, id: { in: refs.tagIds } },
      });
      if (found !== refs.tagIds.length) {
        throw new DmFlowError('VALIDATION_FAILED', {
          details: [{ path: 'filter', message: 'references a tag that does not exist' }],
        });
      }
    }

    if (refs.customFieldIds.length > 0) {
      const found = await this.prisma.customField.count({
        where: { workspaceId, id: { in: refs.customFieldIds } },
      });
      if (found !== refs.customFieldIds.length) {
        throw new DmFlowError('VALIDATION_FAILED', {
          details: [{ path: 'filter', message: 'references a custom field that does not exist' }],
        });
      }
    }
  }

  /** Published automation versions whose graph mentions this id anywhere. */
  private async findAutomationsReferencing(
    workspaceId: string,
    referencedId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT a.id, a.name
      FROM "Automation" a
      JOIN "AutomationVersion" v ON v.id = a."publishedVersionId"
      WHERE a."workspaceId" = ${workspaceId}
        AND a."deletedAt" IS NULL
        AND v.graph::text LIKE ${'%' + referencedId + '%'}
      LIMIT 10
    `;
    return rows;
  }
}
