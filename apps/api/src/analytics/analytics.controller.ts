import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { AnalyticsService } from './analytics.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { WorkspaceContext } from '../common/request-context';

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function resolveRange(q: { from?: Date; to?: Date }) {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermission('analytics:read')
  @Get('overview')
  overview(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.overview(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('executions-over-time')
  overTime(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.executionsOverTime(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('automations')
  automations(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.byAutomation(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('automations/:id/nodes')
  nodes(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id') id: string,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.byNode(ws.id, id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('failures')
  failures(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.failureBreakdown(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('triggers')
  triggers(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.triggerPerformance(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('contacts')
  contacts(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.contactGrowth(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('responsiveness')
  responsiveness(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.responsiveness(ws.id, resolveRange(q));
  }

  @RequirePermission('integration:read')
  @Get('integration-health')
  health(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.integrationHealth(ws.id, resolveRange(q));
  }

  @RequirePermission('analytics:read')
  @Get('inbox-performance')
  inbox(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.analytics.inboxPerformance(ws.id, resolveRange(q));
  }
}
