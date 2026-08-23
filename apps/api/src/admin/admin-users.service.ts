import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  monthlyCents,
  platformRoleHas,
  type PlatformRole,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { DomainEventsService } from './domain-events.service';
import { SessionService } from '../auth/session.service';

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface UserQuery {
  search?: string;
  status?: 'active' | 'suspended' | 'deleted' | 'unverified';
  limit?: number;
  cursor?: string;
}

/**
 * Masks an address so support can recognise the account without reading it.
 *
 * `maria@empresa.com.br` becomes `ma••••@empresa.com.br`. Enough to match
 * against what a customer says on the phone, not enough to be a mailing list.
 */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/**
 * Reading and acting on customer accounts.
 *
 * Two rules run through every method. Personal data is returned only to a role
 * that carries `admin.users.pii` — analysis needs to know that an account
 * exists, not who it belongs to. And nothing here can return a password hash or
 * a TOTP secret, because every read names its columns rather than handing back
 * whatever the table happens to hold.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly events: DomainEventsService,
    private readonly sessions: SessionService,
  ) {}

  async list(role: PlatformRole, query: UserQuery) {
    const take = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const search = query.search?.trim();

    const users = await this.prisma.user.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' as const } },
                { name: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...statusFilter(query.status),
      },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        suspendedAt: true,
        deletedAt: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, name: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = users.slice(0, take);
    return {
      users: page.map((user) => this.present(user, role)),
      // Null rather than an empty string, so "no more pages" cannot be mistaken
      // for "start from the beginning".
      nextCursor: users.length > take ? page[page.length - 1]!.id : null,
    };
  }

  async detail(role: PlatformRole, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        suspendedAt: true,
        suspensionReason: true,
        deletedAt: true,
        createdAt: true,
        totpEnabledAt: true,
        memberships: {
          select: {
            role: true,
            createdAt: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                createdAt: true,
                subscription: { select: { status: true, plan: true, currentPeriodEnd: true } },
                _count: { select: { contacts: true, automations: true, connectedAccounts: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new DmFlowError('NOT_FOUND');

    const [sessions, recentEvents] = await Promise.all([
      this.prisma.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.prisma.domainEvent.findMany({
        where: { userId },
        select: { event: true, occurredAt: true, properties: true },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      ...this.present(user, role),
      // Whether a second factor is on is a security fact, not personal data, and
      // support needs it to answer "why can't I get in".
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      suspensionReason: user.suspensionReason,
      activeSessions: sessions,
      workspaces: user.memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        status: membership.workspace.status,
        role: membership.role,
        joinedAt: membership.createdAt,
        createdAt: membership.workspace.createdAt,
        subscription: membership.workspace.subscription
          ? {
              status: membership.workspace.subscription.status,
              plan: membership.workspace.subscription.plan.code,
              currency: membership.workspace.subscription.plan.currency,
              // The same normalisation the metrics layer uses, so a single
              // account's contribution adds up to the total on the overview.
              monthlyCents: monthlyCents(
                membership.workspace.subscription.plan.priceCents,
                membership.workspace.subscription.plan.interval,
              ),
              currentPeriodEnd: membership.workspace.subscription.currentPeriodEnd,
            }
          : null,
        usage: membership.workspace._count,
      })),
      recentEvents,
    };
  }

  /**
   * Blocks an account.
   *
   * Sessions are revoked in the same operation. A suspension that leaves the
   * person signed in until their cookie expires is a note in a database, not a
   * suspension.
   */
  async suspend(
    actor: { id: string; role: PlatformRole },
    userId: string,
    reason: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    // Before anything changes: a required reason that is checked afterwards
    // leaves the account blocked and the record missing.
    this.audit.assertReason('admin.users.suspend', reason);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new DmFlowError('NOT_FOUND');

    const target = await this.prisma.platformAdmin.findUnique({ where: { userId } });
    if (target && !target.revokedAt) {
      // Suspending an administrator through the customer screen would be a way
      // around the protections on administering administrators.
      throw new DmFlowError('FORBIDDEN', {
        cause: 'revoke the administrative grant before suspending this account',
      });
    }

    if (user.suspendedAt) return { alreadySuspended: true, suspendedAt: user.suspendedAt };

    await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: new Date(), suspensionReason: reason.trim().slice(0, 500) },
    });
    const revoked = await this.sessions.revokeAllForUser(userId);

    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      permission: 'admin.users.suspend',
      action: 'user.suspended',
      entityType: 'User',
      entityId: userId,
      before: { suspendedAt: null },
      after: { suspendedAt: new Date(), sessionsRevoked: revoked },
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    await this.events.record({
      event: 'user.suspended',
      userId,
      actorUserId: actor.id,
      properties: { sessionsRevoked: revoked },
    });

    return { suspended: true, sessionsRevoked: revoked };
  }

  async reactivate(
    actor: { id: string; role: PlatformRole },
    userId: string,
    reason: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    this.audit.assertReason('admin.users.suspend', reason);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new DmFlowError('NOT_FOUND');
    if (!user.suspendedAt) return { alreadyActive: true };

    await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: null, suspensionReason: null },
    });

    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      permission: 'admin.users.suspend',
      action: 'user.reactivated',
      entityType: 'User',
      entityId: userId,
      before: { suspendedAt: user.suspendedAt, reason: user.suspensionReason },
      after: { suspendedAt: null },
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    await this.events.record({ event: 'user.reactivated', userId, actorUserId: actor.id });

    return { reactivated: true };
  }

  /**
   * Shapes one record for the role reading it.
   *
   * The masking happens here rather than at each call site, so a screen added
   * later cannot forget it.
   */
  private present(
    user: {
      id: string;
      email: string;
      name: string;
      locale: string;
      emailVerifiedAt: Date | null;
      lastLoginAt: Date | null;
      suspendedAt: Date | null;
      deletedAt: Date | null;
      createdAt: Date;
      memberships?: Array<{ role: string; workspace: { id: string; name: string; status: string } }>;
    },
    role: PlatformRole,
  ) {
    const mayReadPii = platformRoleHas(role, 'admin.users.pii');

    return {
      id: user.id,
      // Seeing that an account exists and reading who it belongs to are separate
      // questions; only one of them needs a name and an address.
      email: mayReadPii ? user.email : maskEmail(user.email),
      name: mayReadPii ? user.name : null,
      piiMasked: !mayReadPii,
      locale: user.locale,
      emailVerified: Boolean(user.emailVerifiedAt),
      lastLoginAt: user.lastLoginAt,
      suspendedAt: user.suspendedAt,
      deletedAt: user.deletedAt,
      createdAt: user.createdAt,
      workspaceCount: user.memberships?.length ?? 0,
    };
  }
}

function statusFilter(status: UserQuery['status']) {
  switch (status) {
    case 'active':
      return { deletedAt: null, suspendedAt: null };
    case 'suspended':
      return { suspendedAt: { not: null } };
    case 'deleted':
      return { deletedAt: { not: null } };
    case 'unverified':
      return { deletedAt: null, emailVerifiedAt: null };
    default:
      // No filter means everybody, deleted accounts included: an admin looking
      // for somebody who deleted their account should still find them.
      return {};
  }
}
