import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  DmFlowError,
  PLATFORM_ROLES,
  PLATFORM_ROLE_PERMISSIONS,
  uuidv7,
  type PlatformRole,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminGuard } from './admin.guard';
import { RequirePlatformPermission } from './admin.decorator';
import { NoWorkspace } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { zodBody } from '../common/zod.pipe';
import type { AuthenticatedUser, DmFlowRequest } from '../common/request-context';

/**
 * The administrative surface.
 *
 * `@NoWorkspace` because these routes are not about one tenant — an admin is
 * looking across all of them, and demanding a workspace header would be
 * meaningless. Tenancy is replaced, not skipped: AdminGuard is the authority
 * here, and it reads a grant from the database rather than anything the client
 * sent.
 */
@NoWorkspace()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Who the caller is here, and what they may do. Used to shape the interface. */
  @RequirePlatformPermission('admin.metrics.read')
  @Get('me')
  async me(@Req() req: DmFlowRequest) {
    const role = req.platformAdmin!.role;
    return {
      role,
      permissions: [...PLATFORM_ROLE_PERMISSIONS[role]],
    };
  }

  @RequirePlatformPermission('admin.admins.manage')
  @Get('admins')
  async listAdmins() {
    const admins = await this.prisma.platformAdmin.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { grantedAt: 'desc' },
    });

    return admins.map((admin) => ({
      id: admin.id,
      role: admin.role,
      grantedAt: admin.grantedAt,
      revokedAt: admin.revokedAt,
      lastSeenAt: admin.lastSeenAt,
      user: admin.user,
    }));
  }

  @RequirePlatformPermission('admin.admins.manage')
  @Post('admins')
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Body(
      zodBody(
        z.object({
          email: z.string().email().max(200),
          role: z.enum(PLATFORM_ROLES),
          reason: z.string().max(500).optional(),
        }),
      ),
    )
    body: { email: string; role: PlatformRole; reason?: string },
  ) {
    const target = await this.prisma.user.findUnique({
      where: { email: body.email.trim().toLowerCase() },
    });
    if (!target) throw new DmFlowError('NOT_FOUND');

    const existing = await this.prisma.platformAdmin.findUnique({
      where: { userId: target.id },
    });

    const grant = existing
      ? await this.prisma.platformAdmin.update({
          where: { id: existing.id },
          data: { role: body.role, revokedAt: null, grantedById: user.id },
        })
      : await this.prisma.platformAdmin.create({
          data: {
            id: uuidv7(),
            userId: target.id,
            role: body.role,
            grantedById: user.id,
          },
        });

    await this.audit.record({
      actorUserId: user.id,
      actorRole: req.platformAdmin!.role,
      permission: 'admin.admins.manage',
      action: existing ? 'admin.role_changed' : 'admin.granted',
      entityType: 'PlatformAdmin',
      entityId: grant.id,
      before: existing ? { role: existing.role, revokedAt: existing.revokedAt } : null,
      after: { role: grant.role, userId: target.id },
      reason: body.reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { id: grant.id, role: grant.role };
  }

  @RequirePlatformPermission('admin.admins.manage')
  @Post('admins/revoke')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Body(zodBody(z.object({ id: z.string().min(1), reason: z.string().max(500).optional() })))
    body: { id: string; reason?: string },
  ) {
    const grant = await this.prisma.platformAdmin.findUnique({ where: { id: body.id } });
    if (!grant) throw new DmFlowError('NOT_FOUND');

    // Losing the last super admin would lock everybody out of administering the
    // platform, with no way back in short of touching the database directly.
    if (grant.role === 'SUPER_ADMIN' && !grant.revokedAt) {
      const remaining = await this.prisma.platformAdmin.count({
        where: { role: 'SUPER_ADMIN', revokedAt: null, id: { not: grant.id } },
      });
      if (remaining === 0) {
        throw new DmFlowError('FORBIDDEN', {
          cause: 'refusing to revoke the last super admin',
        });
      }
    }

    await this.prisma.platformAdmin.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: user.id,
      actorRole: req.platformAdmin!.role,
      permission: 'admin.admins.manage',
      action: 'admin.revoked',
      entityType: 'PlatformAdmin',
      entityId: grant.id,
      before: { role: grant.role, revokedAt: null },
      after: { revokedAt: new Date() },
      reason: body.reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { ok: true };
  }

  /**
   * The administrative trail.
   *
   * Read-only by design: there is no endpoint that edits or deletes an audit
   * line, because a trail somebody can rewrite is not a trail.
   */
  @RequirePlatformPermission('admin.audit.read')
  @Get('audit')
  async auditTrail(
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);

    const entries = await this.prisma.auditLog.findMany({
      where: {
        actorType: 'PLATFORM_ADMIN',
        ...(action ? { action } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      workspaceId: entry.workspaceId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      ip: entry.ip,
      createdAt: entry.createdAt,
      actor: entry.actor,
    }));
  }

  /**
   * Raw events, for checking that something was recorded at all.
   *
   * Aggregates belong to the metrics layer; this is the underlying log.
   */
  @RequirePlatformPermission('admin.metrics.read')
  @Get('events')
  async events(@Query('event') event?: string, @Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);

    const entries = await this.prisma.domainEvent.findMany({
      where: event ? { event } : {},
      orderBy: { occurredAt: 'desc' },
      take,
    });

    return entries.map((entry) => ({
      id: entry.id,
      event: entry.event,
      workspaceId: entry.workspaceId,
      userId: entry.userId,
      amountCents: entry.amountCents,
      currency: entry.currency,
      properties: entry.properties,
      occurredAt: entry.occurredAt,
    }));
  }
}
