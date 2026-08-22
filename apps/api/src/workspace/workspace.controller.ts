import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { MEMBER_ROLES, type MemberRole } from '@dmflow/shared';
import { WorkspaceService } from './workspace.service';
import { zodBody } from '../common/zod.pipe';
import {
  CurrentUser,
  CurrentWorkspace,
} from '../common/decorators/current-user.decorator';
import { NoWorkspace, RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';

const inviteRole = z.enum(MEMBER_ROLES).refine((r) => r !== 'OWNER', {
  message: 'Ownership is transferred, not invited',
});

@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @NoWorkspace()
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(2).max(120),
          timezone: z.string().max(64).optional(),
          locale: z.string().max(10).optional(),
        }),
      ),
    )
    body: { name: string; timezone?: string; locale?: string },
  ) {
    return this.workspaces.create(user.id, body.name, body.timezone, body.locale);
  }

  @NoWorkspace()
  @Post('invitations/accept')
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ token: z.string().min(10).max(200) }))) body: { token: string },
  ) {
    return this.workspaces.acceptInvitation(body.token, user.id, user.email);
  }

  @RequirePermission('workspace:read')
  @Get('current')
  async current(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.workspaces.get(workspace.id);
  }

  @RequirePermission('workspace:update')
  @Patch('current')
  async update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(2).max(120).optional(),
          timezone: z.string().max(64).optional(),
          locale: z.string().max(10).optional(),
        }),
      ),
    )
    body: { name?: string; timezone?: string; locale?: string },
  ) {
    return this.workspaces.update(workspace.id, user.id, body);
  }

  @RequirePermission('member:read')
  @Get('current/members')
  async members(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.workspaces.listMembers(workspace.id);
  }

  @RequirePermission('member:invite')
  @Post('current/invitations')
  async invite(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ email: z.string().email().max(200), role: inviteRole })))
    body: { email: string; role: MemberRole },
  ) {
    return this.workspaces.invite(workspace.id, user.id, body.email, body.role);
  }

  @RequirePermission('member:invite')
  @Get('current/invitations')
  async invitations(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.workspaces.listInvitations(workspace.id);
  }

  @RequirePermission('member:invite')
  @Delete('current/invitations/:id')
  async revokeInvitation(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.workspaces.revokeInvitation(workspace.id, id, user.id);
  }

  @RequirePermission('member:update_role')
  @Patch('current/members/:id')
  async updateRole(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ role: z.enum(MEMBER_ROLES) }))) body: { role: MemberRole },
  ) {
    return this.workspaces.updateMemberRole(workspace.id, user.id, id, body.role);
  }

  @RequirePermission('member:remove')
  @Delete('current/members/:id')
  async removeMember(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.workspaces.removeMember(workspace.id, user.id, id);
  }

  @RequirePermission('workspace:transfer_ownership')
  @Post('current/transfer-ownership')
  async transfer(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ userId: z.string().min(1).max(64) }))) body: { userId: string },
  ) {
    return this.workspaces.transferOwnership(workspace.id, user.id, body.userId);
  }

  @RequirePermission('audit:read')
  @Get('current/audit')
  async audit(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.workspaces.listMembers(workspace.id).then(() => ({ ok: true }));
  }
}
