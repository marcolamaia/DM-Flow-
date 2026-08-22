import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import {
  DEFAULT_LOCALE,
  DmFlowError,
  getPlanDefinition,
  isLocale,
  isPermittedWhileSuspended,
  roleHasPermission,
  type Permission,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService, SESSION_COOKIE } from './session.service';
import { requestContext } from '../common/logger';
import type { DmFlowRequest } from '../common/request-context';
import {
  NO_WORKSPACE_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
} from '../common/decorators/permissions.decorator';

export const WORKSPACE_HEADER = 'x-dmflow-workspace';

/**
 * One guard resolves identity, tenancy and authorisation, in that order.
 *
 * Authorisation is decided here and nowhere else: a controller never inspects a
 * role. That keeps the answer to "who can do this?" in a single readable place
 * instead of scattered conditionals that drift apart.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DmFlowRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const isPublic = this.readMeta<boolean>(PUBLIC_KEY, context);
    if (isPublic) return true;

    // ── Identity
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string') throw new DmFlowError('NOT_AUTHENTICATED');

    const { userId, sessionId, rotate } = await this.sessions.resolve(token);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new DmFlowError('NOT_AUTHENTICATED');

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: isLocale(user.locale) ? user.locale : DEFAULT_LOCALE,
    };
    req.sessionId = sessionId;

    if (rotate) await this.sessions.rotate(sessionId, res);

    const store = requestContext.getStore();
    if (store) store.userId = user.id;

    const skipWorkspace = this.readMeta<boolean>(NO_WORKSPACE_KEY, context);
    if (skipWorkspace) return true;

    // ── Tenancy. The workspace comes from a header the client sends, but the
    // membership lookup is what authorises it — a forged id resolves to nothing.
    const rawHeader = req.headers[WORKSPACE_HEADER];
    const workspaceId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!workspaceId) throw new DmFlowError('WORKSPACE_ACCESS_DENIED');

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      include: {
        workspace: { include: { subscription: { include: { plan: true } } } },
      },
    });

    if (!membership || membership.workspace.deletedAt) {
      throw new DmFlowError('WORKSPACE_ACCESS_DENIED');
    }

    const workspace = membership.workspace;
    const planCode = workspace.subscription?.plan.code ?? 'free';
    const features = new Set(
      workspace.subscription?.plan.features ?? getPlanDefinition('free')?.features ?? [],
    );

    req.workspace = {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      locale: workspace.locale,
      status: workspace.status,
      role: membership.role,
      planCode,
      features,
    };

    if (store) store.workspaceId = workspace.id;

    // ── Authorisation
    const permission = this.readMeta<Permission>(PERMISSION_KEY, context);
    if (!permission) return true;

    if (!roleHasPermission(membership.role, permission)) {
      throw new DmFlowError('FORBIDDEN', {
        context: { permission, role: membership.role },
      });
    }

    // A suspended workspace stays fully readable and payable. Only the actions that
    // change data or send messages are blocked, so suspension never looks like loss.
    if (workspace.status === 'SUSPENDED' && !isPermittedWhileSuspended(permission)) {
      throw new DmFlowError('WORKSPACE_SUSPENDED', {
        context: { workspaceId: workspace.id, permission },
        remediation: { action: 'open_billing', url: '/settings/billing' },
      });
    }

    return true;
  }

  private readMeta<T>(key: string, context: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
