import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DmFlowError, platformRoleHas, type PlatformPermission, type PlatformRole } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { requestContext, logger } from '../common/logger';
import type { DmFlowRequest } from '../common/request-context';
import { ADMIN_PERMISSION_KEY } from './admin.decorator';

/**
 * The gate on every administrative route.
 *
 * Applied to the whole controller by construction rather than route by route:
 * an endpoint added later that forgets its decorator is refused, not exposed. A
 * missing permission is a locked door, never an open one.
 *
 * Nothing here reads a flag the client sent. The grant is a row in the database,
 * looked up per request, and a revoked grant takes effect immediately rather than
 * lingering until a session expires.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DmFlowRequest>();

    // AuthGuard has already established who this is; without that there is
    // nothing to authorise.
    if (!req.user) throw new DmFlowError('NOT_AUTHENTICATED');

    const grant = await this.prisma.platformAdmin.findUnique({
      where: { userId: req.user.id },
    });

    if (!grant || grant.revokedAt) {
      // Deliberately the same answer as a permission the admin lacks: whether
      // /admin exists at all is not a customer's business.
      logger.warn(
        { userId: req.user.id, path: req.originalUrl },
        'non-admin attempted to reach an administrative route',
      );
      throw new DmFlowError('NOT_FOUND');
    }

    const required = this.reflector.getAllAndOverride<PlatformPermission>(ADMIN_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // An administrative route with no declared permission is a mistake in our
    // code, and the safe reading of a mistake is "nobody".
    if (!required) {
      logger.error({ path: req.originalUrl }, 'administrative route declares no permission');
      throw new DmFlowError('FORBIDDEN');
    }

    if (!platformRoleHas(grant.role as PlatformRole, required)) {
      throw new DmFlowError('FORBIDDEN', {
        context: { permission: required, role: grant.role },
      });
    }

    req.platformAdmin = { role: grant.role as PlatformRole, grantId: grant.id };

    const store = requestContext.getStore();
    if (store) store.userId = req.user.id;

    // Useful for the session list an admin sees of their own access.
    void this.prisma.platformAdmin
      .update({ where: { id: grant.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
