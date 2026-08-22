import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { WorkspaceContext } from '../common/request-context';

@Controller('executions')
export class ExecutionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  @RequirePermission('execution:read')
  @Get()
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('automationId') automationId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const executions = await this.prisma.execution.findMany({
      where: {
        workspaceId: ws.id,
        ...(automationId ? { automationId } : {}),
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(200, Number(limit) || 50),
      include: {
        contact: { select: { id: true, displayName: true, username: true } },
        automation: { select: { id: true, name: true } },
      },
    });

    return executions.map((e) => ({
      id: e.id,
      status: e.status,
      automation: e.automation,
      contact: e.contact,
      currentNodeId: e.currentNodeId,
      stepCount: e.stepCount,
      attemptCount: e.attemptCount,
      resumeAt: e.resumeAt,
      lastError: e.lastError,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
    }));
  }

  /** Per-step detail powering the canvas inspector. */
  @RequirePermission('execution:read')
  @Get(':id')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    const execution = await this.prisma.execution.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { sequence: 'asc' } },
        contact: { select: { id: true, displayName: true, username: true } },
        automation: { select: { id: true, name: true } },
        automationVersion: { select: { id: true, versionNumber: true, graph: true } },
      },
    });
    this.prisma.assertTenant(execution, ws.id);

    return {
      id: execution!.id,
      status: execution!.status,
      automation: execution!.automation,
      version: {
        id: execution!.automationVersion.id,
        versionNumber: execution!.automationVersion.versionNumber,
      },
      graph: execution!.automationVersion.graph,
      contact: execution!.contact,
      variables: execution!.variables,
      currentNodeId: execution!.currentNodeId,
      resumeAt: execution!.resumeAt,
      lastError: execution!.lastError,
      startedAt: execution!.startedAt,
      finishedAt: execution!.finishedAt,
      steps: execution!.steps.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        nodeId: s.nodeId,
        nodeType: s.nodeType,
        status: s.status,
        input: s.input,
        output: s.output,
        errorCode: s.errorCode,
        errorDetail: s.errorDetail,
        durationMs: s.durationMs,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
    };
  }

  @RequirePermission('execution:cancel')
  @Post(':id/cancel')
  async cancel(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    await this.engine.cancel(ws.id, id);
    return { ok: true };
  }
}
