import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  FREE_PLAN_CODE,
  randomToken,
  slugify,
  uuidv7,
  type MemberRole,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { hashToken } from '../common/crypto';
import { QuotaService } from '../billing/quota.service';

const INVITE_TTL_MS = 7 * 86_400_000;

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
  ) {}

  async create(userId: string, name: string, timezone?: string, locale?: string) {
    const freePlan = await this.prisma.plan.findUnique({ where: { code: FREE_PLAN_CODE } });
    if (!freePlan) throw new DmFlowError('INTERNAL_ERROR', { cause: 'Free plan missing' });

    const workspaceId = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.workspace.create({
        data: {
          id: workspaceId,
          name: name.trim(),
          slug: await this.uniqueSlug(name),
          timezone: timezone ?? 'America/Sao_Paulo',
          locale: locale ?? 'pt-BR',
        },
      });
      await tx.workspaceMember.create({
        data: { id: uuidv7(), workspaceId, userId, role: 'OWNER' },
      });
      await tx.subscription.create({
        data: { id: uuidv7(), workspaceId, planId: freePlan.id, status: 'ACTIVE' },
      });
    });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.created',
      entityType: 'Workspace',
      entityId: workspaceId,
    });

    return this.get(workspaceId);
  }

  async get(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!workspace) throw new DmFlowError('NOT_FOUND');

    const usage = await this.quota.snapshot(workspaceId);

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      locale: workspace.locale,
      status: workspace.status,
      suspendedAt: workspace.suspendedAt,
      suspensionReason: workspace.suspensionReason,
      plan: workspace.subscription
        ? {
            code: workspace.subscription.plan.code,
            name: workspace.subscription.plan.name,
            status: workspace.subscription.status,
            currentPeriodEnd: workspace.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: workspace.subscription.cancelAtPeriodEnd,
            lastPaymentError: workspace.subscription.lastPaymentError,
            features: workspace.subscription.plan.features,
            limits: workspace.subscription.plan.limits,
          }
        : null,
      usage,
    };
  }

  async update(
    workspaceId: string,
    userId: string,
    patch: { name?: string; timezone?: string; locale?: string },
  ) {
    const before = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!before) throw new DmFlowError('NOT_FOUND');

    await this.prisma.workspace.update({ where: { id: workspaceId }, data: patch });
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'workspace.updated',
      entityType: 'Workspace',
      entityId: workspaceId,
      before: { name: before.name, timezone: before.timezone, locale: before.locale },
      after: patch,
    });

    return this.get(workspaceId);
  }

  async listMembers(workspaceId: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
      lastLoginAt: m.user.lastLoginAt,
    }));
  }

  async invite(
    workspaceId: string,
    invitedById: string,
    email: string,
    role: MemberRole,
  ): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
    if (role === 'OWNER') {
      throw new DmFlowError('FORBIDDEN', {
        context: { reason: 'ownership is transferred, not invited' },
      });
    }

    await this.quota.assertCanAddMember(workspaceId);

    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email: normalized } },
    });
    if (existing) throw new DmFlowError('ALREADY_EXISTS', { context: { reason: 'already_member' } });

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invitation = await this.prisma.invitation.create({
      data: {
        id: uuidv7(),
        workspaceId,
        email: normalized,
        role,
        tokenHash: hashToken(token),
        invitedById,
        expiresAt,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: invitedById,
      action: 'member.invited',
      entityType: 'Invitation',
      entityId: invitation.id,
      after: { email: normalized, role },
    });

    return { inviteId: invitation.id, token, expiresAt };
  }

  async listInvitations(workspaceId: string) {
    const invitations = await this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      expired: i.expiresAt.getTime() <= Date.now(),
      createdAt: i.createdAt,
    }));
  }

  async revokeInvitation(workspaceId: string, invitationId: string, actorId: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.workspaceId !== workspaceId) throw new DmFlowError('NOT_FOUND');

    await this.prisma.invitation.delete({ where: { id: invitationId } });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'member.invitation_revoked',
      entityType: 'Invitation',
      entityId: invitationId,
    });
    return { ok: true };
  }

  async acceptInvitation(token: string, userId: string, userEmail: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) {
      throw new DmFlowError('NOT_FOUND', { context: { reason: 'invitation_invalid' } });
    }

    // An invitation is addressed to a person, not merely to whoever holds the link.
    if (invitation.email !== userEmail.toLowerCase()) {
      throw new DmFlowError('FORBIDDEN', { context: { reason: 'invitation_email_mismatch' } });
    }

    await this.quota.assertCanAddMember(invitation.workspaceId);

    await this.prisma.$transaction([
      this.prisma.workspaceMember.create({
        data: {
          id: uuidv7(),
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
          invitedById: invitation.invitedById,
        },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      workspaceId: invitation.workspaceId,
      actorUserId: userId,
      action: 'member.joined',
      entityType: 'WorkspaceMember',
      after: { role: invitation.role },
    });

    return { workspaceId: invitation.workspaceId, role: invitation.role };
  }

  async updateMemberRole(
    workspaceId: string,
    actorId: string,
    memberId: string,
    role: MemberRole,
  ) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member || member.workspaceId !== workspaceId) throw new DmFlowError('NOT_FOUND');

    if (member.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(workspaceId, member.userId);
    }

    await this.prisma.workspaceMember.update({ where: { id: memberId }, data: { role } });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'member.role_changed',
      entityType: 'WorkspaceMember',
      entityId: memberId,
      before: { role: member.role },
      after: { role },
    });

    return { ok: true };
  }

  async removeMember(workspaceId: string, actorId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member || member.workspaceId !== workspaceId) throw new DmFlowError('NOT_FOUND');

    if (member.role === 'OWNER') await this.assertNotLastOwner(workspaceId, member.userId);

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });
    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'member.removed',
      entityType: 'WorkspaceMember',
      entityId: memberId,
      before: { userId: member.userId, role: member.role },
    });

    return { ok: true };
  }

  async transferOwnership(workspaceId: string, actorId: string, targetUserId: string) {
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw new DmFlowError('NOT_FOUND');

    await this.prisma.$transaction([
      this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        data: { role: 'OWNER' },
      }),
      this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: actorId } },
        data: { role: 'ADMIN' },
      }),
    ]);

    await this.audit.record({
      workspaceId,
      actorUserId: actorId,
      action: 'workspace.ownership_transferred',
      entityType: 'Workspace',
      entityId: workspaceId,
      after: { newOwnerId: targetUserId },
    });

    return { ok: true };
  }

  private async assertNotLastOwner(workspaceId: string, userId: string): Promise<void> {
    const owners = await this.prisma.workspaceMember.count({
      where: { workspaceId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw new DmFlowError('LAST_OWNER_CANNOT_LEAVE', { context: { workspaceId, userId } });
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'workspace';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomToken(3).toLowerCase()}`;
      const taken = await this.prisma.workspace.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
