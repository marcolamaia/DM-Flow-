import { Controller, Get, Query } from '@nestjs/common';
import { CapabilityService } from './capability.service';
import { CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { WorkspaceContext } from '../common/request-context';

@Controller('capabilities')
export class CapabilityController {
  constructor(private readonly capabilities: CapabilityService) {}

  /**
   * Drives the builder palette. Unavailable capabilities are returned with their
   * reason and the open question blocking them, so the UI can explain rather than
   * silently hide.
   */
  @RequirePermission('automation:read')
  @Get()
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('connectedAccountId') connectedAccountId?: string,
  ) {
    const entries = await this.capabilities.listForAccount(ws.id, connectedAccountId);
    return entries.map((e) => ({
      id: e.id,
      channel: e.channel,
      status: e.status,
      available: e.available,
      label: e.label,
      limitations: e.limitations,
      windowRequirement: e.windowRequirement,
      idempotency: e.idempotency,
      documentedLimits: e.documentedLimits,
      doc: e.doc,
      pendingQuestion: e.pendingQuestion,
    }));
  }
}
