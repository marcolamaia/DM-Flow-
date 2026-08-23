import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  REASON_REQUIRED,
  uuidv7,
  type PlatformPermission,
  type PlatformRole,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from './domain-events.service';
import { logger } from '../common/logger';

export interface AdminActionInput {
  actorUserId: string;
  actorRole: PlatformRole;
  permission: PlatformPermission;
  action: string;
  entityType?: string;
  entityId?: string;
  workspaceId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Records administrative actions, and refuses the ones that arrive without a
 * reason when a reason is required.
 *
 * Unlike ordinary auditing, this runs *before* the action rather than after it.
 * Suspending an account and then failing to record why leaves the account
 * suspended and the record missing; refusing up front leaves nothing changed.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  /**
   * Call before performing the action. Throws when a required reason is absent
   * or too thin to mean anything.
   */
  assertReason(permission: PlatformPermission, reason?: string): void {
    if (!REASON_REQUIRED.has(permission)) return;

    const trimmed = reason?.trim() ?? '';
    if (trimmed.length < 8) {
      throw new DmFlowError('VALIDATION_FAILED', {
        cause: 'this action requires a reason',
        details: [
          {
            path: 'reason',
            message:
              'Explique o motivo desta ação. Ela fica registrada e precisa ser compreensível depois.',
          },
        ],
      });
    }
  }

  async record(input: AdminActionInput): Promise<void> {
    this.assertReason(input.permission, input.reason);

    try {
      await this.prisma.auditLog.create({
        data: {
          id: uuidv7(),
          workspaceId: input.workspaceId ?? null,
          // Distinguishable from a workspace member doing the same thing: the
          // two have very different weight when reading the trail back.
          actorType: 'PLATFORM_ADMIN',
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: (input.before ?? undefined) as never,
          after: (input.after ?? undefined) as never,
          reason: input.reason?.trim() || null,
          ip: input.ip,
          userAgent: input.userAgent?.slice(0, 300),
        },
      });
    } catch (error) {
      // The action has already happened by now, so failing here cannot undo it.
      // Loud, and never swallowed into silence.
      logger.error(
        { err: error instanceof Error ? error.message : String(error), action: input.action },
        'FAILED TO WRITE ADMIN AUDIT LOG',
      );
    }

    await this.events.record({
      event: 'admin.action',
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      properties: {
        action: input.action,
        role: input.actorRole,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }
}
