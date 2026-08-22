import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from './logger';

export interface AuditInput {
  workspaceId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'AUTOMATION';
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append-only. Audit writes never block or fail the action they describe — a
   * lost audit line is bad, a refused payment because of one is worse.
   */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: uuidv7(),
          workspaceId: input.workspaceId ?? null,
          actorType: input.actorType ?? 'USER',
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: (input.before ?? undefined) as never,
          after: (input.after ?? undefined) as never,
          ip: input.ip,
          userAgent: input.userAgent?.slice(0, 300),
        },
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), action: input.action },
        'failed to write audit log',
      );
    }
  }
}
