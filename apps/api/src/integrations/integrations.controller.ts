import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { TemplatesService } from './templates.service';
import { OutboundWebhooksService, OUTBOUND_EVENTS } from './outbound-webhooks.service';
import { ApiKeysService } from './api-keys.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';

@Controller()
export class IntegrationsController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly webhooks: OutboundWebhooksService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  // ── Templates
  @RequirePermission('template:read')
  @Get('templates')
  listTemplates(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.templates.list(ws.id);
  }

  @RequirePermission('template:manage')
  @Post('templates')
  createTemplate(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          automationId: z.string().min(1).max(64),
          name: z.string().min(1).max(160),
          description: z.string().max(500).optional(),
          category: z.string().max(60).optional(),
        }),
      ),
    )
    body: { automationId: string; name: string; description?: string; category?: string },
  ) {
    return this.templates.createFromAutomation(ws.id, user.id, body.automationId, body);
  }

  @RequirePermission('automation:create')
  @Post('templates/:id/install')
  installTemplate(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          createMissing: z.boolean().default(true),
          connectedAccountId: z.string().max(64).optional(),
        }),
      ),
    )
    body: { createMissing: boolean; connectedAccountId?: string },
  ) {
    return this.templates.install(ws.id, user.id, id, body);
  }

  // ── Outbound webhooks
  @RequirePermission('webhook:manage')
  @Get('outbound-webhooks')
  listWebhooks(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.webhooks.list(ws.id);
  }

  @RequirePermission('webhook:manage')
  @Get('outbound-webhooks/events')
  listEvents() {
    return OUTBOUND_EVENTS;
  }

  @RequirePermission('webhook:manage')
  @Post('outbound-webhooks')
  createWebhook(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(120),
          url: z.string().url().max(2000),
          events: z.array(z.string().max(60)).min(1).max(20),
        }),
      ),
    )
    body: { name: string; url: string; events: string[] },
  ) {
    return this.webhooks.create(ws.id, body);
  }

  @RequirePermission('webhook:manage')
  @Get('outbound-webhooks/:id/deliveries')
  deliveries(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.webhooks.listDeliveries(ws.id, id, Math.min(100, Number(limit) || 25));
  }

  @RequirePermission('webhook:manage')
  @Delete('outbound-webhooks/:id')
  removeWebhook(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.webhooks.remove(ws.id, id);
  }

  // ── API keys
  @RequirePermission('api_key:manage')
  @Get('api-keys')
  listKeys(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.apiKeys.list(ws.id);
  }

  @RequirePermission('api_key:manage')
  @Post('api-keys')
  createKey(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(120),
          scopes: z.array(z.string().max(60)).max(20).default(['contacts:write', 'automations:trigger']),
        }),
      ),
    )
    body: { name: string; scopes: string[] },
  ) {
    return this.apiKeys.create(ws.id, user.id, body.name, body.scopes);
  }

  @RequirePermission('api_key:manage')
  @Delete('api-keys/:id')
  revokeKey(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.apiKeys.revoke(ws.id, user.id, id);
  }
}
