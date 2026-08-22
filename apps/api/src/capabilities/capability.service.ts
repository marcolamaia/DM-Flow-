import { Injectable } from '@nestjs/common';
import {
  allow,
  deny,
  getCapabilityEntry,
  isLiveAvailable,
  listCapabilities,
  uuidv7,
  type CapabilityDecision,
  type CapabilityEntry,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface CapabilityRequest {
  capabilityId: string;
  workspaceId: string;
  connectedAccountId?: string;
  conversationId?: string;
  contactId?: string;
  /** For one-shot actions: the external target the attempt is spent on. */
  oneShotTarget?: string;
  /** The event that started this execution, for ORIGIN_EVENT capabilities. */
  originEventType?: string;
  /**
   * Who is acting. Handoff pauses AUTOMATION on a conversation — the whole point is
   * that a human takes over, so an AGENT must still be able to reply there.
   */
  actor?: 'AUTOMATION' | 'AGENT';
  now?: Date;
}

/**
 * The single place that answers "is this allowed right now?".
 *
 * The Flow Builder, publish validation and the running engine all call this same
 * function. When design-time and run-time rules live in separate code they drift,
 * and the result is a flow that looks valid in the editor and fails silently in
 * production — the worst outcome for the operator.
 */
@Injectable()
export class CapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Capabilities offered to the builder for a given account. */
  async listForAccount(
    workspaceId: string,
    connectedAccountId?: string,
  ): Promise<Array<CapabilityEntry & { available: boolean }>> {
    const account = connectedAccountId
      ? await this.prisma.connectedAccount.findUnique({ where: { id: connectedAccountId } })
      : null;
    if (account) this.prisma.assertTenant(account, workspaceId);

    const sandbox = account?.isSandbox ?? true;
    return listCapabilities(sandbox).map((entry) => ({
      ...entry,
      available: entry.status === 'SANDBOX_SIMULATED' || isLiveAvailable(entry.status),
    }));
  }

  async availableIds(workspaceId: string, connectedAccountId?: string): Promise<Set<string>> {
    const entries = await this.listForAccount(workspaceId, connectedAccountId);
    return new Set(entries.filter((e) => e.available).map((e) => e.id));
  }

  async decide(request: CapabilityRequest): Promise<CapabilityDecision> {
    const now = request.now ?? new Date();
    const { capabilityId } = request;

    // ── Workspace standing
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: request.workspaceId },
    });
    if (!workspace || workspace.status === 'SUSPENDED') {
      return deny(capabilityId, 'WORKSPACE_SUSPENDED', {
        remediation: { action: 'open_billing', url: '/settings/billing' },
      });
    }

    // ── Account standing
    const account = request.connectedAccountId
      ? await this.prisma.connectedAccount.findUnique({ where: { id: request.connectedAccountId } })
      : null;

    if (request.connectedAccountId && (!account || account.workspaceId !== request.workspaceId)) {
      return deny(capabilityId, 'ACCOUNT_DISCONNECTED');
    }

    const sandbox = account?.isSandbox ?? true;
    const entry = getCapabilityEntry(capabilityId, sandbox);

    // ── The deny-by-default rule. There is no flag that overrides this: the only
    // way through is to validate the capability and update the registry.
    if (!entry) {
      return deny(capabilityId, 'NOT_VALIDATED');
    }
    if (entry.status !== 'SANDBOX_SIMULATED' && !isLiveAvailable(entry.status)) {
      return deny(capabilityId, this.reasonForStatus(entry.status), {
        pendingQuestion: entry.pendingQuestion,
      });
    }

    if (account) {
      if (account.deletedAt || account.status === 'DISCONNECTED') {
        return deny(capabilityId, 'ACCOUNT_DISCONNECTED');
      }
      if (account.status === 'TOKEN_INVALID') {
        return deny(capabilityId, 'TOKEN_INVALID', {
          remediation: { action: 'reconnect_account', url: '/settings/channels' },
        });
      }
      if (account.status === 'RATE_LIMITED') {
        return deny(capabilityId, 'RATE_LIMITED');
      }

      const missingScopes = entry.requiredScopes.filter(
        (scope) => !account.grantedScopes.includes(scope),
      );
      if (missingScopes.length > 0) {
        return deny(capabilityId, 'MISSING_PERMISSION', {
          remediation: { action: 'reconnect_account', url: '/settings/channels' },
        });
      }

      if (
        entry.requiredAccountTypes.length > 0 &&
        (!account.accountType || !entry.requiredAccountTypes.includes(account.accountType))
      ) {
        return deny(capabilityId, 'ACCOUNT_TYPE_UNSUPPORTED');
      }
    }

    // ── Contact standing. An opted-out contact is never messaged, whatever the
    // flow says, because honouring that is what keeps the channel usable at all.
    if (request.contactId) {
      const contact = await this.prisma.contact.findUnique({ where: { id: request.contactId } });
      if (contact && contact.workspaceId === request.workspaceId) {
        if (contact.status !== 'ACTIVE') {
          return deny(capabilityId, 'CONTACT_UNSUBSCRIBED');
        }
      }
    }

    // ── One-shot actions. Checked before the window so an already-spent attempt
    // reports the honest reason rather than a confusing window error.
    if (entry.idempotency === 'ONE_SHOT_GLOBAL' && request.oneShotTarget) {
      const used = await this.prisma.idempotencyRecord.findUnique({
        where: {
          workspaceId_scope_key: {
            workspaceId: request.workspaceId,
            scope: capabilityId,
            key: request.oneShotTarget,
          },
        },
      });
      if (used) return deny(capabilityId, 'ONE_SHOT_ALREADY_USED');
    }

    // ── Conversation window
    if (entry.windowRequirement !== 'NONE' && request.conversationId) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: request.conversationId },
      });

      if (!conversation || conversation.workspaceId !== request.workspaceId) {
        return deny(capabilityId, 'ACCOUNT_DISCONNECTED');
      }

      const actor = request.actor ?? 'AUTOMATION';
      if (conversation.automationPausedAt && actor === 'AUTOMATION') {
        return deny(capabilityId, 'AUTOMATION_PAUSED');
      }

      if (entry.windowRequirement === 'ORIGIN_EVENT') {
        // A private reply is only legal as an answer to the event that produced it.
        if (!request.oneShotTarget) {
          return deny(capabilityId, 'ORIGIN_EVENT_REQUIRED');
        }
      } else {
        const state = conversation.windowState;
        const expired =
          conversation.windowExpiresAt !== null &&
          conversation.windowExpiresAt.getTime() <= now.getTime();

        if (state === 'UNKNOWN') {
          // Refusing to send is recoverable. Sending against a rule we could not
          // confirm may not be.
          return deny(capabilityId, 'WINDOW_UNKNOWN', {
            pendingQuestion: entry.pendingQuestion,
          });
        }
        if (state === 'CLOSED' || expired) {
          return deny(capabilityId, 'OUTSIDE_MESSAGING_WINDOW');
        }
        if (entry.windowRequirement === 'OPEN' && state === 'EXTENDED') {
          // An extended window is a human-agent mechanism, not an automation one.
          return deny(capabilityId, 'OUTSIDE_MESSAGING_WINDOW');
        }
      }
    }

    return allow(
      capabilityId,
      Object.entries(entry.documentedLimits).map(([key, value]) => ({ key, value })),
    );
  }

  /** Marks a one-shot attempt as spent. Must be called before the outbound call. */
  async claimOneShot(
    workspaceId: string,
    capabilityId: string,
    target: string,
    resultRef?: unknown,
  ): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          id: uuidv7(),
          workspaceId,
          scope: capabilityId,
          key: target,
          resultRef: (resultRef ?? undefined) as never,
        },
      });
      return true;
    } catch {
      // Unique violation: someone else already spent this attempt.
      return false;
    }
  }

  private reasonForStatus(status: CapabilityEntry['status']) {
    switch (status) {
      case 'REQUIRES_APP_REVIEW':
        return 'APP_REVIEW_REQUIRED' as const;
      case 'REQUIRES_ADVANCED_ACCESS':
        return 'ADVANCED_ACCESS_REQUIRED' as const;
      case 'DEPENDS_ON_ACCOUNT_TYPE':
        return 'ACCOUNT_TYPE_UNSUPPORTED' as const;
      case 'NOT_AVAILABLE':
        return 'POLICY_PROHIBITED' as const;
      default:
        return 'NOT_VALIDATED' as const;
    }
  }
}
