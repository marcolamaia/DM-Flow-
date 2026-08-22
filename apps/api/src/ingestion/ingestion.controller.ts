import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { IngestionService } from './ingestion.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { WorkspaceContext } from '../common/request-context';

@Controller('events')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @RequirePermission('integration:read')
  @Get()
  list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('limit') limit?: string,
  ) {
    return this.ingestion.listEvents(ws.id, Math.min(200, Number(limit) || 50));
  }

  /**
   * Replay defaults to a dry run. Re-sending has to be asked for explicitly,
   * because some outbound actions can only ever be attempted once per target.
   */
  @RequirePermission('integration:manage')
  @Post('replay')
  replay(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(
      zodBody(
        z.object({
          eventIds: z.array(z.string()).min(1).max(500),
          withSideEffects: z.boolean().default(false),
        }),
      ),
    )
    body: { eventIds: string[]; withSideEffects: boolean },
  ) {
    return this.ingestion.replay(ws.id, body.eventIds, {
      withSideEffects: body.withSideEffects,
    });
  }
}
