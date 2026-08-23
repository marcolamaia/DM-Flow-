import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { TRIGGER_TYPES, flowGraphSchema, type TriggerType } from '@dmflow/shared';
import { AutomationsService } from './automations.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission, RequireVerifiedEmail } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';

const triggerSchema = z.object({
  type: z.enum(TRIGGER_TYPES),
  connectedAccountId: z.string().max(64).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  matchPriority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
});

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @RequirePermission('automation:read')
  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.automations.list(ws.id);
  }

  @RequirePermission('automation:read')
  @Get('trigger-definitions')
  triggerDefinitions(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('connectedAccountId') accountId?: string,
  ) {
    return this.automations.listTriggerDefinitions(ws.id, accountId);
  }

  @RequirePermission('automation:read')
  @Get(':id')
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.automations.get(ws.id, id);
  }

  @RequirePermission('automation:create')
  @Post()
  create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(160),
          description: z.string().max(500).optional(),
        }),
      ),
    )
    body: { name: string; description?: string },
  ) {
    return this.automations.create(ws.id, user.id, body.name, body.description);
  }

  @RequirePermission('automation:update')
  @Patch(':id')
  async rename(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(160).optional(),
          description: z.string().max(500).optional(),
        }),
      ),
    )
    body: { name?: string; description?: string },
  ) {
    return this.automations.setName(ws.id, user.id, id, body);
  }

  /** Autosave target for the builder. */
  @RequirePermission('automation:update')
  @Put(':id/draft')
  saveDraft(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ graph: flowGraphSchema }))) body: { graph: unknown },
  ) {
    return this.automations.saveDraft(ws.id, user.id, id, body.graph);
  }

  @RequirePermission('automation:publish')
  @RequireVerifiedEmail()
  @Post(':id/publish')
  publish(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.automations.publish(ws.id, user.id, id);
  }

  @RequirePermission('automation:update')
  @Post(':id/status')
  setStatus(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(z.object({ status: z.enum(['PUBLISHED', 'PAUSED', 'ARCHIVED']) })))
    body: { status: 'PUBLISHED' | 'PAUSED' | 'ARCHIVED' },
  ) {
    return this.automations.setStatus(ws.id, user.id, id, body.status);
  }

  @RequirePermission('automation:delete')
  @Delete(':id')
  remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.automations.remove(ws.id, user.id, id);
  }

  @RequirePermission('automation:read')
  @Get(':id/versions')
  versions(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.automations.listVersions(ws.id, id);
  }

  @RequirePermission('automation:update')
  @Post(':id/versions/:versionId/restore')
  restore(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.automations.restoreVersion(ws.id, user.id, id, versionId);
  }

  // ── Triggers
  @RequirePermission('automation:update')
  @Post(':id/triggers')
  addTrigger(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(triggerSchema)) body: z.infer<typeof triggerSchema>,
  ) {
    return this.automations.upsertTrigger(ws.id, user.id, id, body as never);
  }

  @RequirePermission('automation:update')
  @Patch(':id/triggers/:triggerId')
  updateTrigger(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('triggerId') triggerId: string,
    @Body(zodBody(triggerSchema)) body: z.infer<typeof triggerSchema>,
  ) {
    return this.automations.upsertTrigger(ws.id, user.id, id, body as never, triggerId);
  }

  @RequirePermission('automation:update')
  @Delete(':id/triggers/:triggerId')
  deleteTrigger(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('triggerId') triggerId: string,
  ) {
    return this.automations.deleteTrigger(ws.id, user.id, triggerId);
  }
}
