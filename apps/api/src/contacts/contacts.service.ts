import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  uuidv7,
  type Channel,
  type PredicateNode,
  predicateSchema,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { QuotaService } from '../billing/quota.service';
import { compilePredicate } from './predicate-sql';

export interface ContactListQuery {
  search?: string;
  status?: string;
  channel?: Channel;
  tagIds?: string[];
  segmentId?: string;
  predicate?: PredicateNode;
  sort?: 'recent' | 'created' | 'name';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
  ) {}

  async list(workspaceId: string, query: ContactListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const clauses: string[] = ['c."workspaceId" = $1', 'c."deletedAt" IS NULL'];
    const params: unknown[] = [workspaceId];

    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (query.status) clauses.push(`c.status = ${bind(query.status)}::"ContactStatus"`);
    if (query.channel) clauses.push(`c."primaryChannel" = ${bind(query.channel)}::"Channel"`);

    if (query.search) {
      const term = `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      clauses.push(
        `(c."displayName" ILIKE ${bind(term)} OR c.username ILIKE ${bind(term)})`,
      );
    }

    if (query.tagIds?.length) {
      // Every listed tag must be present, not any of them: "leads AND paid" is the
      // useful reading, and "any" is expressible with an OR predicate instead.
      for (const tagId of query.tagIds) {
        clauses.push(
          `EXISTS (SELECT 1 FROM "ContactTag" ct WHERE ct."contactId" = c.id AND ct."tagId" = ${bind(tagId)})`,
        );
      }
    }

    let predicate = query.predicate;
    if (query.segmentId) {
      const segment = await this.prisma.segment.findUnique({ where: { id: query.segmentId } });
      this.prisma.assertTenant(segment, workspaceId);
      predicate = predicateSchema.parse(segment!.filter);
    }

    if (predicate) {
      const compiled = compilePredicate(predicate);
      // Re-number the compiled placeholders so they continue this query's sequence.
      const offset = params.length;
      const shifted = compiled.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`);
      params.push(...compiled.params);
      clauses.push(`(${shifted})`);
    }

    const where = clauses.join(' AND ');
    const orderBy =
      query.sort === 'name'
        ? 'c."displayName" ASC NULLS LAST'
        : query.sort === 'created'
          ? 'c."createdAt" DESC'
          : 'c."lastInteractionAt" DESC NULLS LAST, c."createdAt" DESC';

    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT c.id FROM "Contact" c WHERE ${where} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      ...params,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "Contact" c WHERE ${where}`,
      ...params,
    );

    const total = Number(totalRows[0]?.count ?? 0);
    const ids = rows.map((r) => r.id);
    const contacts = ids.length > 0 ? await this.loadMany(workspaceId, ids) : [];

    return {
      data: ids.map((id) => contacts.find((c) => c.id === id)).filter(Boolean),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    };
  }

  async get(workspaceId: string, contactId: string) {
    const [contact] = await this.loadMany(workspaceId, [contactId]);
    if (!contact) throw new DmFlowError('NOT_FOUND');
    return contact;
  }

  private async loadMany(workspaceId: string, ids: string[]) {
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null },
      include: {
        identities: true,
        tags: { include: { tag: true } },
        fieldValues: { include: { customField: true } },
        conversations: {
          select: {
            id: true,
            status: true,
            windowState: true,
            windowExpiresAt: true,
            lastInboundAt: true,
            channel: true,
          },
        },
      },
    });

    return contacts.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      username: c.username,
      avatarUrl: c.avatarUrl,
      primaryChannel: c.primaryChannel,
      status: c.status,
      source: c.source,
      locale: c.locale,
      consentState: c.consentState,
      firstSeenAt: c.firstSeenAt,
      lastInteractionAt: c.lastInteractionAt,
      createdAt: c.createdAt,
      identities: c.identities.map((i) => ({
        channel: i.channel,
        externalUserId: i.externalUserId,
        username: i.username,
      })),
      tags: c.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      customFields: c.fieldValues.map((v) => ({
        id: v.customFieldId,
        key: v.customField.key,
        label: v.customField.label,
        type: v.customField.type,
        value: v.value,
      })),
      conversations: c.conversations,
    }));
  }

  async create(
    workspaceId: string,
    actorId: string,
    input: {
      displayName?: string;
      username?: string;
      primaryChannel: Channel;
      locale?: string;
      source?: string;
    },
  ) {
    await this.quota.assertCanAddContact(workspaceId);

    const contact = await this.prisma.contact.create({
      data: {
        id: uuidv7(),
        workspaceId,
        primaryChannel: input.primaryChannel,
        displayName: input.displayName?.trim(),
        username: input.username?.trim(),
        locale: input.locale,
        source: input.source ?? 'manual',
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'contact.created',
      entityType: 'Contact',
      entityId: contact.id,
    });

    return this.get(workspaceId, contact.id);
  }

  async update(
    workspaceId: string,
    actorId: string,
    contactId: string,
    patch: { displayName?: string; username?: string; locale?: string; status?: string },
  ) {
    const existing = await this.prisma.contact.findUnique({ where: { id: contactId } });
    this.prisma.assertTenant(existing, workspaceId);

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        displayName: patch.displayName,
        username: patch.username,
        locale: patch.locale,
        status: patch.status as never,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'contact.updated',
      entityType: 'Contact',
      entityId: contactId,
      before: { status: existing!.status, displayName: existing!.displayName },
      after: patch,
    });

    return this.get(workspaceId, contactId);
  }

  /** Soft delete keeps conversation history coherent; erasure is a separate path. */
  async remove(workspaceId: string, actorId: string, contactId: string) {
    const existing = await this.prisma.contact.findUnique({ where: { id: contactId } });
    this.prisma.assertTenant(existing, workspaceId);

    await this.prisma.contact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'contact.deleted',
      entityType: 'Contact',
      entityId: contactId,
    });
    return { ok: true };
  }

  async setStatus(
    workspaceId: string,
    actorId: string,
    contactId: string,
    status: 'ACTIVE' | 'UNSUBSCRIBED' | 'BLOCKED',
  ) {
    return this.update(workspaceId, actorId, contactId, { status });
  }

  // ── Tags on contacts ───────────────────────────────────────

  async addTag(workspaceId: string, contactId: string, tagId: string, actor: { userId?: string; automationId?: string }) {
    const [contact, tag] = await Promise.all([
      this.prisma.contact.findUnique({ where: { id: contactId } }),
      this.prisma.tag.findUnique({ where: { id: tagId } }),
    ]);
    this.prisma.assertTenant(contact, workspaceId);
    this.prisma.assertTenant(tag, workspaceId);

    // Re-applying an existing tag is a no-op, not an error: automations re-run.
    const existing = await this.prisma.contactTag.findUnique({
      where: { contactId_tagId: { contactId, tagId } },
    });
    if (existing) return { applied: false };

    await this.prisma.contactTag.create({
      data: {
        contactId,
        tagId,
        appliedBy: actor.automationId
          ? { type: 'AUTOMATION', id: actor.automationId }
          : { type: 'USER', id: actor.userId ?? null },
      },
    });

    return { applied: true };
  }

  async removeTag(workspaceId: string, contactId: string, tagId: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    this.prisma.assertTenant(contact, workspaceId);

    await this.prisma.contactTag
      .delete({ where: { contactId_tagId: { contactId, tagId } } })
      .catch(() => undefined);
    return { removed: true };
  }

  // ── Custom field values ────────────────────────────────────

  async setFieldValue(
    workspaceId: string,
    contactId: string,
    customFieldId: string,
    value: unknown,
  ) {
    const [contact, field] = await Promise.all([
      this.prisma.contact.findUnique({ where: { id: contactId } }),
      this.prisma.customField.findUnique({ where: { id: customFieldId } }),
    ]);
    this.prisma.assertTenant(contact, workspaceId);
    this.prisma.assertTenant(field, workspaceId);

    const coerced = this.coerceFieldValue(field!.type, value);

    await this.prisma.customFieldValue.upsert({
      where: { contactId_customFieldId: { contactId, customFieldId } },
      create: {
        id: uuidv7(),
        workspaceId,
        contactId,
        customFieldId,
        value: coerced as never,
      },
      update: { value: coerced as never },
    });

    return { ok: true };
  }

  async clearFieldValue(workspaceId: string, contactId: string, customFieldId: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    this.prisma.assertTenant(contact, workspaceId);

    await this.prisma.customFieldValue
      .delete({ where: { contactId_customFieldId: { contactId, customFieldId } } })
      .catch(() => undefined);
    return { ok: true };
  }

  /**
   * Values are stored as JSON but must respect the field's declared type, otherwise
   * a NUMBER field silently holds "abc" and every numeric comparison downstream lies.
   */
  private coerceFieldValue(type: string, value: unknown): unknown {
    if (value === null || value === undefined || value === '') return null;

    switch (type) {
      case 'NUMBER': {
        const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
        if (!Number.isFinite(n)) {
          throw new DmFlowError('VALIDATION_FAILED', {
            details: [{ path: 'value', message: 'expected a number' }],
          });
        }
        return n;
      }
      case 'BOOLEAN':
        if (typeof value === 'boolean') return value;
        return ['true', '1', 'sim', 'yes'].includes(String(value).toLowerCase());
      case 'DATE':
      case 'DATETIME': {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) {
          throw new DmFlowError('VALIDATION_FAILED', {
            details: [{ path: 'value', message: 'expected a valid date' }],
          });
        }
        return d.toISOString();
      }
      default:
        return String(value).slice(0, 2000);
    }
  }

  // ── Bulk / import / export ─────────────────────────────────

  async bulkTag(workspaceId: string, contactIds: string[], tagId: string, actorId: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    this.prisma.assertTenant(tag, workspaceId);

    const owned = await this.prisma.contact.findMany({
      where: { id: { in: contactIds }, workspaceId, deletedAt: null },
      select: { id: true },
    });

    await this.prisma.contactTag.createMany({
      data: owned.map((c) => ({
        contactId: c.id,
        tagId,
        appliedBy: { type: 'USER', id: actorId } as never,
      })),
      skipDuplicates: true,
    });

    return { tagged: owned.length, requested: contactIds.length };
  }

  async export(workspaceId: string, contactIds?: string[]) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(contactIds?.length ? { id: { in: contactIds } } : {}),
      },
      include: {
        tags: { include: { tag: true } },
        fieldValues: { include: { customField: true } },
        identities: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return contacts.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      username: c.username,
      channel: c.primaryChannel,
      status: c.status,
      source: c.source,
      firstSeenAt: c.firstSeenAt?.toISOString() ?? null,
      lastInteractionAt: c.lastInteractionAt?.toISOString() ?? null,
      tags: c.tags.map((t) => t.tag.name).join('|'),
      identities: c.identities.map((i) => `${i.channel}:${i.externalUserId}`).join('|'),
      ...Object.fromEntries(
        c.fieldValues.map((v) => [`field:${v.customField.key}`, v.value as never]),
      ),
    }));
  }

  /**
   * Imported contacts almost never have an open messaging window, so they cannot be
   * messaged until they write first. The API says so explicitly rather than letting
   * the operator discover it when a broadcast silently fails.
   */
  async import(
    workspaceId: string,
    actorId: string,
    rows: Array<{ displayName?: string; username?: string; channel?: string; tags?: string[] }>,
  ) {
    await this.quota.assertCanAddContact(workspaceId, rows.length);

    let created = 0;
    for (const row of rows) {
      const contact = await this.prisma.contact.create({
        data: {
          id: uuidv7(),
          workspaceId,
          primaryChannel: (row.channel as Channel) ?? 'INSTAGRAM',
          displayName: row.displayName?.trim(),
          username: row.username?.trim(),
          source: 'import',
        },
      });
      created += 1;

      if (row.tags?.length) {
        const tags = await this.prisma.tag.findMany({
          where: { workspaceId, name: { in: row.tags } },
        });
        await this.prisma.contactTag.createMany({
          data: tags.map((t) => ({
            contactId: contact.id,
            tagId: t.id,
            appliedBy: { type: 'USER', id: actorId } as never,
          })),
          skipDuplicates: true,
        });
      }
    }

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'contact.imported',
      after: { count: created },
    });

    return {
      created,
      notice: {
        'pt-BR':
          'Contatos importados ficam salvos, mas só podem receber mensagem depois que a pessoa escrever para você — a janela de mensagens do canal exige isso.',
        en: 'Imported contacts are stored, but can only be messaged after the person writes to you: the channel’s messaging window requires it.',
      },
    };
  }

  async merge(workspaceId: string, actorId: string, primaryId: string, duplicateId: string) {
    if (primaryId === duplicateId) throw new DmFlowError('VALIDATION_FAILED');

    const [primary, duplicate] = await Promise.all([
      this.prisma.contact.findUnique({ where: { id: primaryId } }),
      this.prisma.contact.findUnique({ where: { id: duplicateId } }),
    ]);
    this.prisma.assertTenant(primary, workspaceId);
    this.prisma.assertTenant(duplicate, workspaceId);

    await this.prisma.$transaction(async (tx) => {
      await tx.contactIdentity.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });
      await tx.conversation.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });
      await tx.execution.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });

      const dupTags = await tx.contactTag.findMany({ where: { contactId: duplicateId } });
      await tx.contactTag.createMany({
        data: dupTags.map((t) => ({ contactId: primaryId, tagId: t.tagId })),
        skipDuplicates: true,
      });
      await tx.contactTag.deleteMany({ where: { contactId: duplicateId } });

      // Existing values on the primary win: the merge must not overwrite data the
      // operator can already see with data from the record being absorbed.
      const dupValues = await tx.customFieldValue.findMany({ where: { contactId: duplicateId } });
      for (const value of dupValues) {
        const exists = await tx.customFieldValue.findUnique({
          where: {
            contactId_customFieldId: {
              contactId: primaryId,
              customFieldId: value.customFieldId,
            },
          },
        });
        if (!exists) {
          await tx.customFieldValue.create({
            data: {
              id: uuidv7(),
              workspaceId,
              contactId: primaryId,
              customFieldId: value.customFieldId,
              value: value.value as never,
            },
          });
        }
      }
      await tx.customFieldValue.deleteMany({ where: { contactId: duplicateId } });

      await tx.contact.update({
        where: { id: duplicateId },
        data: { deletedAt: new Date(), status: 'BLOCKED' },
      });
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'contact.merged',
      entityType: 'Contact',
      entityId: primaryId,
      before: { duplicateId },
    });

    return this.get(workspaceId, primaryId);
  }
}
