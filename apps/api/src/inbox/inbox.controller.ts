import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { InboxService } from './inbox.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';

const filtersSchema = z.object({
  status: z.enum(['OPEN', 'SNOOZED', 'CLOSED']).optional(),
  assigneeId: z.string().max(64).optional(),
  channel: z.string().max(20).optional(),
  tagId: z.string().max(64).optional(),
  windowState: z.enum(['OPEN', 'EXTENDED', 'CLOSED', 'UNKNOWN']).optional(),
  unreadOnly: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(64).optional(),
});

@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @RequirePermission('inbox:read')
  @Get('counts')
  counts(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthenticatedUser) {
    return this.inbox.counts(ws.id, user.id);
  }

  @RequirePermission('inbox:read')
  @Get('conversations')
  list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(filtersSchema)) query: z.infer<typeof filtersSchema>,
  ) {
    return this.inbox.listConversations(ws.id, query as never);
  }

  @RequirePermission('inbox:read')
  @Get('conversations/:id')
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.inbox.getConversation(ws.id, id);
  }

  @RequirePermission('inbox:send')
  @Post('conversations/:id/messages')
  send(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ text: z.string().min(1).max(1000) }))) body: { text: string },
  ) {
    return this.inbox.sendMessage(ws.id, user.id, id, body.text);
  }

  @RequirePermission('inbox:assign')
  @Post('conversations/:id/assign')
  assign(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ assigneeId: z.string().max(64).nullable() })))
    body: { assigneeId: string | null },
  ) {
    return this.inbox.assign(ws.id, user.id, id, body.assigneeId);
  }

  @RequirePermission('inbox:change_status')
  @Post('conversations/:id/status')
  setStatus(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          status: z.enum(['OPEN', 'SNOOZED', 'CLOSED']),
          snoozeMinutes: z.number().int().min(1).max(43_200).optional(),
        }),
      ),
    )
    body: { status: 'OPEN' | 'SNOOZED' | 'CLOSED'; snoozeMinutes?: number },
  ) {
    return this.inbox.setStatus(ws.id, id, body.status, body.snoozeMinutes);
  }

  @RequirePermission('inbox:read')
  @Post('conversations/:id/read')
  markRead(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.inbox.markRead(ws.id, id);
  }

  /** Human takes over: automations stop sending into this conversation. */
  @RequirePermission('inbox:send')
  @Post('conversations/:id/handoff')
  handoff(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ paused: z.boolean() }))) body: { paused: boolean },
  ) {
    return this.inbox.setAutomationPaused(ws.id, user.id, id, body.paused);
  }

  @RequirePermission('inbox:note')
  @Post('conversations/:id/notes')
  addNote(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ body: z.string().min(1).max(2000) }))) body: { body: string },
  ) {
    return this.inbox.addNote(ws.id, user.id, id, body.body);
  }
}
