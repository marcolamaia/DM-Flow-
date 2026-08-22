import { Injectable } from '@nestjs/common';
import { CAP, DmFlowError, uuidv7 } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityService } from '../capabilities/capability.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { ChannelsService } from '../channels/channels.service';
import { QuotaService } from '../billing/quota.service';
import { AuditService } from '../common/audit.service';
import { InboxGateway } from './inbox.gateway';

export interface ConversationFilters {
  status?: 'OPEN' | 'SNOOZED' | 'CLOSED';
  assigneeId?: string | 'unassigned';
  channel?: string;
  tagId?: string;
  unreadOnly?: boolean;
  windowState?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityService,
    private readonly providers: ProviderRegistry,
    private readonly channels: ChannelsService,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
    private readonly gateway: InboxGateway,
  ) {}

  async listConversations(workspaceId: string, filters: ConversationFilters) {
    const limit = Math.min(100, filters.limit ?? 30);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.assigneeId === 'unassigned'
          ? { assigneeId: null }
          : filters.assigneeId
            ? { assigneeId: filters.assigneeId }
            : {}),
        ...(filters.channel ? { channel: filters.channel as never } : {}),
        ...(filters.windowState ? { windowState: filters.windowState as never } : {}),
        ...(filters.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
        ...(filters.tagId ? { contact: { tags: { some: { tagId: filters.tagId } } } } : {}),
        ...(filters.search
          ? {
              contact: {
                OR: [
                  { displayName: { contains: filters.search, mode: 'insensitive' } },
                  { username: { contains: filters.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ lastInboundAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
      include: {
        contact: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
            status: true,
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          },
        },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return {
      data: conversations.map((c) => ({
        id: c.id,
        status: c.status,
        channel: c.channel,
        unreadCount: c.unreadCount,
        windowState: c.windowState,
        windowExpiresAt: c.windowExpiresAt,
        automationPaused: Boolean(c.automationPausedAt),
        lastInboundAt: c.lastInboundAt,
        lastOutboundAt: c.lastOutboundAt,
        snoozedUntil: c.snoozedUntil,
        contact: {
          ...c.contact,
          tags: c.contact.tags.map((t) => t.tag),
        },
        assignee: c.assignee,
        lastMessage: c.messages[0]
          ? {
              direction: c.messages[0].direction,
              senderType: c.messages[0].senderType,
              content: c.messages[0].content,
              createdAt: c.messages[0].createdAt,
            }
          : null,
      })),
      nextCursor: conversations.length === limit ? conversations.at(-1)?.id : null,
    };
  }

  async getConversation(workspaceId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: {
          include: {
            tags: { include: { tag: true } },
            fieldValues: { include: { customField: true } },
            identities: true,
          },
        },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        connectedAccount: { select: { id: true, username: true, isSandbox: true, status: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });
    this.prisma.assertTenant(conversation, workspaceId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    const activeExecutions = await this.prisma.execution.count({
      where: { conversationId, status: { in: ['RUNNING', 'WAITING'] } },
    });

    // Whether the operator can type right now is the same decision the engine
    // makes before sending, asked of the same function.
    const sendDecision = await this.capabilities.decide({
      capabilityId: CAP.IG_SEND_TEXT,
      workspaceId,
      connectedAccountId: conversation!.connectedAccountId,
      conversationId,
      contactId: conversation!.contactId,
      actor: 'AGENT',
    });

    return {
      id: conversation!.id,
      status: conversation!.status,
      channel: conversation!.channel,
      windowState: conversation!.windowState,
      windowExpiresAt: conversation!.windowExpiresAt,
      windowBasis: conversation!.windowBasis,
      automationPaused: Boolean(conversation!.automationPausedAt),
      activeExecutions,
      account: conversation!.connectedAccount,
      assignee: conversation!.assignee,
      canSend: sendDecision.allowed,
      sendBlockedReason: sendDecision.allowed ? null : sendDecision.reason,
      sendBlockedMessage: sendDecision.allowed ? null : sendDecision.userMessage,
      contact: {
        id: conversation!.contact.id,
        displayName: conversation!.contact.displayName,
        username: conversation!.contact.username,
        avatarUrl: conversation!.contact.avatarUrl,
        status: conversation!.contact.status,
        source: conversation!.contact.source,
        firstSeenAt: conversation!.contact.firstSeenAt,
        lastInteractionAt: conversation!.contact.lastInteractionAt,
        tags: conversation!.contact.tags.map((t) => ({
          id: t.tag.id,
          name: t.tag.name,
          color: t.tag.color,
        })),
        customFields: conversation!.contact.fieldValues.map((v) => ({
          id: v.customFieldId,
          key: v.customField.key,
          label: v.customField.label,
          value: v.value,
        })),
        identities: conversation!.contact.identities.map((i) => ({
          channel: i.channel,
          externalUserId: i.externalUserId,
        })),
      },
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        senderType: m.senderType,
        senderUserId: m.senderUserId,
        contentType: m.contentType,
        content: m.content,
        status: m.status,
        failureCode: m.failureCode,
        executionId: m.executionId,
        createdAt: m.createdAt,
        sentAt: m.sentAt,
      })),
      notes: conversation!.notes.map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author,
        createdAt: n.createdAt,
      })),
      // History starts at connection time; the platform does not hand us what came
      // before, and pretending otherwise would read as missing data to the operator.
      historyNotice: {
        'pt-BR': 'O histórico começa quando esta conta foi conectada à DM FLOW.',
        en: 'History starts when this account was connected to DM FLOW.',
      },
    };
  }

  /** Manual send. Routed through the same capability decision as automated sends. */
  async sendMessage(
    workspaceId: string,
    userId: string,
    conversationId: string,
    text: string,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { connectedAccount: true },
    });
    this.prisma.assertTenant(conversation, workspaceId);

    const decision = await this.capabilities.decide({
      capabilityId: CAP.IG_SEND_TEXT,
      workspaceId,
      connectedAccountId: conversation!.connectedAccountId,
      conversationId,
      contactId: conversation!.contactId,
      actor: 'AGENT',
    });

    if (!decision.allowed) {
      throw new DmFlowError(
        decision.reason === 'OUTSIDE_MESSAGING_WINDOW'
          ? 'WINDOW_CLOSED'
          : decision.reason === 'WINDOW_UNKNOWN'
            ? 'WINDOW_UNKNOWN'
            : decision.reason === 'CONTACT_UNSUBSCRIBED'
              ? 'CONTACT_UNSUBSCRIBED'
              : 'CAPABILITY_NOT_VALIDATED',
        { context: { reason: decision.reason } },
      );
    }

    if (!(await this.quota.tryConsume(workspaceId, 'messages_sent'))) {
      throw new DmFlowError('PLAN_LIMIT_REACHED', { context: { metric: 'messages_sent' } });
    }

    const identity = await this.prisma.contactIdentity.findFirst({
      where: {
        contactId: conversation!.contactId,
        connectedAccountId: conversation!.connectedAccountId,
      },
    });
    if (!identity) throw new DmFlowError('NOT_FOUND', { context: { reason: 'no_identity' } });

    const messageId = uuidv7();
    await this.prisma.message.create({
      data: {
        id: messageId,
        workspaceId,
        conversationId,
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        senderUserId: userId,
        contentType: 'text',
        content: { blocks: [{ type: 'text', text }] } as never,
        status: 'QUEUED',
      },
    });

    const provider = this.providers.forAccount(
      conversation!.connectedAccount.channel,
      conversation!.connectedAccount.isSandbox,
    );

    try {
      const result = await provider.sendMessage(
        {
          accountId: conversation!.connectedAccountId,
          accessToken: await this.channels.accessTokenFor(conversation!.connectedAccountId),
          externalAccountId: conversation!.connectedAccount.externalAccountId,
          recipientExternalId: identity.externalUserId,
          conversationId,
        },
        { blocks: [{ type: 'text', text }] },
      );

      const message = await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'SENT',
          externalMessageId: result.externalMessageId,
          sentAt: result.sentAt,
        },
      });

      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastOutboundAt: result.sentAt, unreadCount: 0 },
      });

      this.gateway.emitMessage(workspaceId, conversationId, message);
      return message;
    } catch (error) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'FAILED',
          failureCode: (error as { providerCode?: string }).providerCode ?? 'PROVIDER_ERROR',
          failureDetail: { message: (error as Error).message } as never,
        },
      });
      throw new DmFlowError('PROVIDER_ERROR', { cause: (error as Error).message });
    }
  }

  async assign(workspaceId: string, actorId: string, conversationId: string, assigneeId: string | null) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    this.prisma.assertTenant(conversation, workspaceId);

    if (assigneeId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
      });
      if (!member) throw new DmFlowError('NOT_FOUND', { context: { reason: 'not_a_member' } });
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { assigneeId },
    });

    this.gateway.emitConversationUpdate(workspaceId, updated);
    return { ok: true, assigneeId };
  }

  async setStatus(
    workspaceId: string,
    conversationId: string,
    status: 'OPEN' | 'SNOOZED' | 'CLOSED',
    snoozeMinutes?: number,
  ) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    this.prisma.assertTenant(conversation, workspaceId);

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        snoozedUntil:
          status === 'SNOOZED' && snoozeMinutes
            ? new Date(Date.now() + snoozeMinutes * 60_000)
            : null,
        unreadCount: status === 'CLOSED' ? 0 : conversation!.unreadCount,
      },
    });

    this.gateway.emitConversationUpdate(workspaceId, updated);
    return { ok: true, status };
  }

  async markRead(workspaceId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    this.prisma.assertTenant(conversation, workspaceId);

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
    return { ok: true };
  }

  /**
   * Human handoff. While a person is on a conversation, automations must not send
   * into it — two voices answering the same customer is worse than none.
   */
  async setAutomationPaused(
    workspaceId: string,
    actorId: string,
    conversationId: string,
    paused: boolean,
  ) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    this.prisma.assertTenant(conversation, workspaceId);

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { automationPausedAt: paused ? new Date() : null },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: paused ? 'inbox.automation_paused' : 'inbox.automation_resumed',
      entityType: 'Conversation',
      entityId: conversationId,
    });

    this.gateway.emitConversationUpdate(workspaceId, updated);
    return { ok: true, automationPaused: paused };
  }

  async addNote(workspaceId: string, authorUserId: string, conversationId: string, body: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    this.prisma.assertTenant(conversation, workspaceId);

    const note = await this.prisma.conversationNote.create({
      data: { id: uuidv7(), workspaceId, conversationId, authorUserId, body },
      include: { author: { select: { id: true, name: true } } },
    });

    return { id: note.id, body: note.body, author: note.author, createdAt: note.createdAt };
  }

  async counts(workspaceId: string, userId: string) {
    const [open, unassigned, mine, unread] = await Promise.all([
      this.prisma.conversation.count({ where: { workspaceId, status: 'OPEN' } }),
      this.prisma.conversation.count({ where: { workspaceId, status: 'OPEN', assigneeId: null } }),
      this.prisma.conversation.count({ where: { workspaceId, status: 'OPEN', assigneeId: userId } }),
      this.prisma.conversation.count({ where: { workspaceId, unreadCount: { gt: 0 } } }),
    ]);
    return { open, unassigned, mine, unread };
  }
}
