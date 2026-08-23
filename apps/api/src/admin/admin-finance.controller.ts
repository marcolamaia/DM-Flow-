import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from './admin.guard';
import { RequirePlatformPermission } from './admin.decorator';
import { NoWorkspace } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { zodBody } from '../common/zod.pipe';
import { AdminFinanceService } from './admin-finance.service';
import { AdminWebhooksService } from './admin-webhooks.service';
import { resolvePeriod } from './metrics.controller';
import type { AuthenticatedUser, DmFlowRequest } from '../common/request-context';

/**
 * The money screens: what comes in, what is stuck, and whether the platform and
 * the payment provider still agree with each other.
 */
@NoWorkspace()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly finance: AdminFinanceService,
    private readonly webhooks: AdminWebhooksService,
  ) {}

  @RequirePlatformPermission('admin.billing.read')
  @Get('finance/by-plan')
  byPlan() {
    return this.finance.byPlan();
  }

  @RequirePlatformPermission('admin.billing.read')
  @Get('finance/cashflow')
  cashflow(@Query('from') from?: string, @Query('to') to?: string, @Query('tz') tz?: string) {
    return this.finance.cashflow(resolvePeriod(from, to, tz));
  }

  @RequirePlatformPermission('admin.billing.read')
  @Get('finance/collection-problems')
  collectionProblems(@Req() req: DmFlowRequest) {
    return this.finance.collectionProblems(req.platformAdmin!.role);
  }

  @RequirePlatformPermission('admin.billing.refund')
  @Post('finance/refund')
  refund(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Body(
      zodBody(
        z.object({
          paymentIntentId: z.string().min(1).max(120),
          // Absent means the whole payment. Never defaulted to a number.
          amountCents: z.number().int().positive().optional(),
          reason: z.string().max(500).optional(),
        }),
      ),
    )
    body: { paymentIntentId: string; amountCents?: number; reason?: string },
  ) {
    return this.finance.refund(
      { id: actor.id, role: req.platformAdmin!.role },
      { ...body, reason: body.reason ?? '' },
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  // ── Webhooks and reconciliation ────────────────────────────

  @RequirePlatformPermission('admin.billing.read')
  @Get('webhooks/health')
  webhookHealth() {
    return this.webhooks.health();
  }

  @RequirePlatformPermission('admin.billing.read')
  @Get('webhooks')
  listWebhooks(
    @Query('status') status?: 'failed' | 'pending' | 'processed',
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.webhooks.list({ status, type, limit: limit ? Number(limit) : undefined });
  }

  @RequirePlatformPermission('admin.jobs.manage')
  @Post('webhooks/:id/reprocess')
  reprocess(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Param('id') id: string,
    @Body(zodBody(z.object({ reason: z.string().max(500).optional() })))
    body: { reason?: string },
  ) {
    return this.webhooks.reprocess(
      { id: actor.id, role: req.platformAdmin!.role },
      id,
      body.reason ?? '',
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @RequirePlatformPermission('admin.billing.read')
  @Get('reconciliation')
  reconcile() {
    return this.webhooks.reconcile();
  }
}
