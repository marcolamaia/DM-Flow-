import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  CAP,
  DmFlowError,
  evaluatePredicate,
  interpolate,
  parseNodeConfig,
  predicateSchema,
  uuidv7,
  type FlowNode,
  type PredicateSubject,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityService } from '../capabilities/capability.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { ChannelsService } from '../channels/channels.service';
import { QuotaService } from '../billing/quota.service';
import { ContactsService } from '../contacts/contacts.service';
import { safeFetch } from './safe-fetch';
import { logger } from '../common/logger';
import type { ExecutionContextData, NodeOutcome } from './engine.types';

@Injectable()
export class NodeExecutorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityService,
    private readonly providers: ProviderRegistry,
    private readonly channels: ChannelsService,
    private readonly quota: QuotaService,
    private readonly contacts: ContactsService,
  ) {}

  async execute(node: FlowNode, ctx: ExecutionContextData): Promise<NodeOutcome> {
    const parsed = parseNodeConfig(node.type, node.config);
    if (!parsed.success) {
      return {
        kind: 'fail',
        errorCode: 'FLOW_NODE_INVALID',
        errorDetail: { issues: parsed.error.issues.map((i) => i.message) },
        retryable: false,
      };
    }
    const config = parsed.data as Record<string, unknown>;

    switch (node.type) {
      case 'trigger':
        return { kind: 'continue' };
      case 'end':
        return { kind: 'end' };
      case 'send_message':
        return this.sendMessage(node, config, ctx);
      case 'condition':
        return this.condition(config, ctx);
      case 'branch':
        return this.branch(config, ctx);
      case 'randomizer':
        return this.randomizer(node, config);
      case 'start_automation':
        return this.startAutomation(config);
      case 'delay':
        return this.delay(config, ctx);
      case 'add_tag':
        return this.addTag(config, ctx);
      case 'remove_tag':
        return this.removeTag(config, ctx);
      case 'set_custom_field':
        return this.setCustomField(config, ctx);
      case 'clear_custom_field':
        return this.clearCustomField(config, ctx);
      case 'http_request':
        return this.httpRequest(node, config, ctx);
      case 'assign_conversation':
        return this.assignConversation(config, ctx);
      case 'set_conversation_status':
        return this.setConversationStatus(config, ctx);
      case 'notify_team':
        return this.notifyTeam(config, ctx);
      case 'unsubscribe_contact':
        return this.unsubscribeContact(ctx);
      default:
        return { kind: 'fail', errorCode: 'FLOW_NODE_INVALID', retryable: false };
    }
  }

  // ── Messaging ──────────────────────────────────────────────

  private async sendMessage(
    node: FlowNode,
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const asPrivateReply = Boolean(config.asPrivateReply);
    const capabilityId = asPrivateReply ? CAP.IG_SEND_PRIVATE_REPLY : CAP.IG_SEND_TEXT;
    const oneShotTarget = asPrivateReply ? ctx.origin.commentId : undefined;

    if (asPrivateReply && !oneShotTarget) {
      return {
        kind: 'fail',
        errorCode: 'ORIGIN_EVENT_REQUIRED',
        errorDetail: { reason: 'private reply needs the comment that started this run' },
        retryable: false,
      };
    }

    const decision = await this.capabilities.decide({
      capabilityId,
      workspaceId: ctx.workspaceId,
      connectedAccountId: ctx.connectedAccountId ?? undefined,
      conversationId: ctx.conversationId ?? undefined,
      contactId: ctx.contactId,
      oneShotTarget,
    });

    if (!decision.allowed) {
      return {
        kind: 'fail',
        errorCode: `CAPABILITY_${decision.reason}`,
        errorDetail: { capabilityId, userMessage: decision.userMessage },
        // A closed window is not a transient error: retrying cannot help until the
        // contact writes again, so the step ends rather than looping.
        retryable: false,
      };
    }

    const allowedByQuota = await this.quota.tryConsume(ctx.workspaceId, 'messages_sent');
    if (!allowedByQuota) {
      return {
        kind: 'fail',
        errorCode: 'PLAN_LIMIT_REACHED',
        errorDetail: { metric: 'messages_sent' },
        retryable: false,
      };
    }

    const contact = await this.prisma.contact.findUnique({ where: { id: ctx.contactId } });
    const identity = await this.prisma.contactIdentity.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        contactId: ctx.contactId,
        connectedAccountId: ctx.connectedAccountId ?? undefined,
      },
    });
    const account = ctx.connectedAccountId
      ? await this.prisma.connectedAccount.findUnique({ where: { id: ctx.connectedAccountId } })
      : null;

    if (!identity || !account) {
      return { kind: 'fail', errorCode: 'PROVIDER_TOKEN_INVALID', retryable: false };
    }

    const interpolationContext = {
      contact: {
        displayName: contact?.displayName ?? '',
        username: contact?.username ?? '',
        id: contact?.id ?? '',
        locale: contact?.locale ?? '',
      },
      variables: ctx.variables,
      trigger: ctx.origin,
    };

    const blocks = (config.blocks as Array<Record<string, unknown>>).map((block) => ({
      ...block,
      text: block.text ? interpolate(String(block.text), interpolationContext) : undefined,
    })) as never;

    // One-shot attempts are claimed BEFORE the call. If the send then fails
    // ambiguously we have still spent it — losing one reply is far better than
    // double-messaging a customer or burning a second attempt that may not exist.
    if (asPrivateReply && oneShotTarget) {
      const claimed = await this.capabilities.claimOneShot(
        ctx.workspaceId,
        capabilityId,
        oneShotTarget,
        { executionId: ctx.executionId, nodeId: node.id },
      );
      if (!claimed) {
        return { kind: 'fail', errorCode: 'ONE_SHOT_ALREADY_USED', retryable: false };
      }
    }

    const provider = this.providers.forAccount(account.channel, account.isSandbox);
    const accessToken = await this.channels.accessTokenFor(account.id);

    const messageId = uuidv7();
    // The intent is recorded before the call so an ambiguous timeout leaves evidence
    // rather than a silent gap between "we tried" and "it arrived".
    await this.prisma.message.create({
      data: {
        id: messageId,
        workspaceId: ctx.workspaceId,
        conversationId: ctx.conversationId!,
        direction: 'OUTBOUND',
        senderType: 'AUTOMATION',
        contentType: 'text',
        content: { blocks, quickReplies: config.quickReplies ?? [] } as never,
        status: 'QUEUED',
        executionId: ctx.executionId,
      },
    });

    try {
      const result =
        asPrivateReply && provider.sendPrivateReply
          ? await provider.sendPrivateReply(
              {
                accountId: account.id,
                accessToken,
                externalAccountId: account.externalAccountId,
                commentId: ctx.origin.commentId!,
                mediaId: ctx.origin.mediaId ?? '',
              },
              { blocks, quickReplies: config.quickReplies as never },
            )
          : await provider.sendMessage(
              {
                accountId: account.id,
                accessToken,
                externalAccountId: account.externalAccountId,
                recipientExternalId: identity.externalUserId,
                conversationId: ctx.conversationId ?? undefined,
              },
              { blocks, quickReplies: config.quickReplies as never },
            );

      await this.prisma.$transaction([
        this.prisma.message.update({
          where: { id: messageId },
          data: {
            status: 'SENT',
            externalMessageId: result.externalMessageId,
            sentAt: result.sentAt,
          },
        }),
        this.prisma.conversation.update({
          where: { id: ctx.conversationId! },
          data: { lastOutboundAt: result.sentAt },
        }),
      ]);

      return {
        kind: 'continue',
        output: { messageId, externalMessageId: result.externalMessageId, usage: result.usage },
      };
    } catch (error) {
      const providerCode = (error as { providerCode?: string }).providerCode ?? 'PROVIDER_ERROR';
      const retryable = Boolean((error as { retryable?: boolean }).retryable);

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'FAILED',
          failureCode: providerCode,
          failureDetail: { message: (error as Error).message } as never,
        },
      });

      logger.warn(
        { executionId: ctx.executionId, providerCode, retryable },
        'outbound send failed',
      );

      return {
        kind: 'fail',
        errorCode: providerCode === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
        errorDetail: { providerCode, message: (error as Error).message },
        retryable,
      };
    }
  }

  // ── Logic ──────────────────────────────────────────────────

  private async buildSubject(ctx: ExecutionContextData): Promise<PredicateSubject> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: ctx.contactId },
      include: { tags: true, fieldValues: true },
    });
    const conversation = ctx.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: ctx.conversationId } })
      : null;

    return {
      contact: {
        id: contact!.id,
        status: contact!.status,
        primaryChannel: contact!.primaryChannel,
        displayName: contact!.displayName,
        username: contact!.username,
        locale: contact!.locale,
        source: contact!.source,
        consentState: contact!.consentState,
        firstSeenAt: contact!.firstSeenAt,
        lastInteractionAt: contact!.lastInteractionAt,
        createdAt: contact!.createdAt,
      },
      tagIds: new Set(contact!.tags.map((t) => t.tagId)),
      customFields: new Map(contact!.fieldValues.map((v) => [v.customFieldId, v.value])),
      conversation: conversation
        ? {
            status: conversation.status,
            windowState: conversation.windowState,
            assigneeId: conversation.assigneeId,
            lastInboundAt: conversation.lastInboundAt,
            unreadCount: conversation.unreadCount,
          }
        : undefined,
      variables: ctx.variables,
      now: new Date(),
    };
  }

  private async condition(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const predicate = predicateSchema.parse(config.predicate);
    const subject = await this.buildSubject(ctx);
    const result = evaluatePredicate(predicate, subject);
    return { kind: 'continue', handle: result ? 'true' : 'false', output: { result } };
  }

  private async branch(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const branches = config.branches as Array<{ id: string; label: string; predicate: unknown }>;
    const subject = await this.buildSubject(ctx);

    // First match wins, so branch order is meaningful and predictable.
    for (const branch of branches) {
      if (evaluatePredicate(predicateSchema.parse(branch.predicate), subject)) {
        return { kind: 'continue', handle: branch.id, output: { matched: branch.id } };
      }
    }

    // Falls through to the branch node's fallback exit. If that exit leads
    // nowhere the run ends there, which is the same outcome as before — but now
    // it is a path the operator can see and connect.
    return { kind: 'continue', handle: 'otherwise', output: { matched: null } };
  }

  /**
   * Weighted split.
   *
   * The draw is per execution and never re-run: a contact who reaches this node
   * once has one answer, so a retry after a failed send downstream cannot move
   * them to the other path mid-journey.
   */
  private randomizer(node: FlowNode, config: Record<string, unknown>): NodeOutcome {
    const paths = config.paths as Array<{ id: string; label: string; weight: number }>;
    const total = paths.reduce((sum, path) => sum + path.weight, 0);
    if (total <= 0) {
      return {
        kind: 'fail',
        errorCode: 'FLOW_NODE_INVALID',
        errorDetail: { reason: 'randomizer weights add up to zero' },
        retryable: false,
      };
    }

    let roll = Math.random() * total;
    for (const path of paths) {
      roll -= path.weight;
      if (roll < 0) {
        return { kind: 'continue', handle: path.id, output: { chose: path.id } };
      }
    }

    // Only reachable through floating-point drift at the very end of the range.
    const last = paths[paths.length - 1]!;
    return { kind: 'continue', handle: last.id, output: { chose: last.id } };
  }

  private startAutomation(config: Record<string, unknown>): NodeOutcome {
    return {
      kind: 'handoff',
      automationId: String(config.automationId),
      stopCurrent: config.stopCurrent !== false,
    };
  }

  private async delay(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const zone = ctx.workspaceTimezone || 'UTC';
    let resumeAt: DateTime;

    if (config.mode === 'until_date' && config.untilDate) {
      resumeAt = DateTime.fromISO(String(config.untilDate), { zone });
    } else {
      const amount = Number(config.amount ?? 1);
      const unit = String(config.unit ?? 'hours') as 'minutes' | 'hours' | 'days';
      resumeAt = DateTime.now().setZone(zone).plus({ [unit]: amount });
    }

    const window = config.resumeWindow as
      | { enabled: boolean; startHour: number; endHour: number }
      | undefined;

    if (window?.enabled) {
      resumeAt = this.shiftIntoWindow(resumeAt, window.startHour, window.endHour);
    }

    return { kind: 'wait', resumeAt: resumeAt.toJSDate(), output: { resumeAt: resumeAt.toISO() } };
  }

  /**
   * Moves a resume time into the operator's permitted hours, in workspace local
   * time. Using local time is the point: "never message before 8am" means 8am where
   * the business is, and Luxon handles the DST transitions that make naive maths wrong.
   */
  private shiftIntoWindow(at: DateTime, startHour: number, endHour: number): DateTime {
    const hour = at.hour;

    if (startHour <= endHour) {
      if (hour < startHour) return at.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
      if (hour >= endHour) {
        return at.plus({ days: 1 }).set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
      }
      return at;
    }

    // Overnight window, e.g. 22:00–06:00.
    if (hour >= endHour && hour < startHour) {
      return at.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
    }
    return at;
  }

  // ── Contact data ───────────────────────────────────────────

  private async addTag(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    try {
      const result = await this.contacts.addTag(
        ctx.workspaceId,
        ctx.contactId,
        String(config.tagId),
        { automationId: ctx.automationId },
      );
      return { kind: 'continue', output: result };
    } catch (error) {
      return this.dataFailure(error, 'TAG_NOT_FOUND');
    }
  }

  private async removeTag(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    await this.contacts.removeTag(ctx.workspaceId, ctx.contactId, String(config.tagId));
    return { kind: 'continue' };
  }

  private async setCustomField(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const raw = config.value;
    const value =
      typeof raw === 'string'
        ? interpolate(raw, { variables: ctx.variables, trigger: ctx.origin })
        : raw;

    try {
      await this.contacts.setFieldValue(
        ctx.workspaceId,
        ctx.contactId,
        String(config.customFieldId),
        value,
      );
      return { kind: 'continue', output: { value } };
    } catch (error) {
      return this.dataFailure(error, 'CUSTOM_FIELD_INVALID');
    }
  }

  private async clearCustomField(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    await this.contacts.clearFieldValue(
      ctx.workspaceId,
      ctx.contactId,
      String(config.customFieldId),
    );
    return { kind: 'continue' };
  }

  private async unsubscribeContact(ctx: ExecutionContextData): Promise<NodeOutcome> {
    await this.prisma.contact.update({
      where: { id: ctx.contactId },
      data: { status: 'UNSUBSCRIBED', consentState: 'DENIED', consentUpdatedAt: new Date() },
    });
    return { kind: 'end', output: { unsubscribed: true } };
  }

  // ── Integration ────────────────────────────────────────────

  private async httpRequest(
    node: FlowNode,
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const features = await this.quota.featuresFor(ctx.workspaceId);
    if (!features.has('http_request_node')) {
      return {
        kind: 'fail',
        errorCode: 'PLAN_LIMIT_REACHED',
        errorDetail: { feature: 'http_request_node' },
        retryable: false,
      };
    }

    const interpolationContext = { variables: ctx.variables, trigger: ctx.origin };
    const url = interpolate(String(config.url), interpolationContext);
    const body = config.body
      ? interpolate(String(config.body), interpolationContext)
      : undefined;

    try {
      const response = await safeFetch(url, {
        method: String(config.method ?? 'GET'),
        headers: (config.headers as Record<string, string>) ?? {},
        body,
        timeoutMs: Number(config.timeoutMs ?? 10_000),
      });

      const output: Record<string, unknown> = {
        status: response.status,
        truncated: response.truncated,
      };
      if (config.saveAs) output[String(config.saveAs)] = response.json ?? response.body;

      // A 5xx is worth another attempt; a 4xx means the request itself is wrong.
      if (response.status >= 500) {
        return {
          kind: 'fail',
          errorCode: 'PROVIDER_ERROR',
          errorDetail: { status: response.status },
          retryable: true,
        };
      }

      return { kind: 'continue', output };
    } catch (error) {
      if (error instanceof DmFlowError) {
        return {
          kind: 'fail',
          errorCode: error.code,
          errorDetail: { context: error.context },
          retryable: error.retryable,
        };
      }
      return {
        kind: 'fail',
        errorCode: 'PROVIDER_ERROR',
        errorDetail: { message: (error as Error).message },
        retryable: true,
      };
    }
  }

  // ── Inbox ──────────────────────────────────────────────────

  private async assignConversation(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    if (!ctx.conversationId) return { kind: 'continue', output: { skipped: 'no_conversation' } };

    const assigneeId = config.assigneeId ? String(config.assigneeId) : null;
    if (assigneeId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: assigneeId } },
      });
      if (!member) {
        return {
          kind: 'fail',
          errorCode: 'NOT_FOUND',
          errorDetail: { reason: 'assignee is not a member of this workspace' },
          retryable: false,
        };
      }
    }

    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { assigneeId },
    });
    return { kind: 'continue', output: { assigneeId } };
  }

  private async setConversationStatus(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    if (!ctx.conversationId) return { kind: 'continue', output: { skipped: 'no_conversation' } };

    const status = String(config.status) as 'OPEN' | 'SNOOZED' | 'CLOSED';
    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: {
        status,
        snoozedUntil:
          status === 'SNOOZED' && config.snoozeMinutes
            ? new Date(Date.now() + Number(config.snoozeMinutes) * 60_000)
            : null,
      },
    });
    return { kind: 'continue', output: { status } };
  }

  private async notifyTeam(
    config: Record<string, unknown>,
    ctx: ExecutionContextData,
  ): Promise<NodeOutcome> {
    const message = interpolate(String(config.message), {
      variables: ctx.variables,
      trigger: ctx.origin,
    });

    if (ctx.conversationId) {
      await this.prisma.conversationNote.create({
        data: {
          id: uuidv7(),
          workspaceId: ctx.workspaceId,
          conversationId: ctx.conversationId,
          // Automation notes are attributed to the automation's creator so the note
          // has a real author rather than a dangling reference.
          authorUserId: await this.resolveNoteAuthor(ctx),
          body: `[automação] ${message}`,
        },
      });
    }

    return { kind: 'continue', output: { message } };
  }

  private async resolveNoteAuthor(ctx: ExecutionContextData): Promise<string> {
    const automation = await this.prisma.automation.findUnique({
      where: { id: ctx.automationId },
      select: { createdById: true },
    });
    if (automation?.createdById) return automation.createdById;

    const owner = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: ctx.workspaceId, role: 'OWNER' },
    });
    return owner!.userId;
  }

  private dataFailure(error: unknown, fallbackCode: string): NodeOutcome {
    if (error instanceof DmFlowError) {
      return {
        kind: 'fail',
        errorCode: error.code,
        errorDetail: { context: error.context },
        retryable: false,
      };
    }
    return {
      kind: 'fail',
      errorCode: fallbackCode,
      errorDetail: { message: (error as Error).message },
      retryable: false,
    };
  }
}
