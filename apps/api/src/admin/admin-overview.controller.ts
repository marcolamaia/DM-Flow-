import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PLATFORM_ROLES } from '@dmflow/shared';
import { AdminGuard } from './admin.guard';
import { RequirePlatformPermission } from './admin.decorator';
import { NoWorkspace } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { zodBody } from '../common/zod.pipe';
import { MetricsService } from './metrics.service';
import { AdminUsersService } from './admin-users.service';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { resolvePeriod } from './metrics.controller';
import type { AuthenticatedUser, DmFlowRequest } from '../common/request-context';

const reasonSchema = z.string().max(500).optional();

/**
 * The screens: what is happening, who the customers are, what they pay.
 *
 * Every figure comes from MetricsService rather than a query written here, so
 * the overview and any report answer with the same number.
 */
@NoWorkspace()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminOverviewController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly users: AdminUsersService,
    private readonly subscriptions: AdminSubscriptionsService,
  ) {}

  /**
   * The first screen.
   *
   * Deliberately small: revenue as it stands, what moved over the window, and
   * the counts behind both. A dashboard that shows twenty numbers teaches
   * nobody which three matter.
   */
  @RequirePlatformPermission('admin.metrics.read')
  @Get('overview')
  async overview(@Query('from') from?: string, @Query('to') to?: string, @Query('tz') tz?: string) {
    const period = resolvePeriod(from, to, tz);
    const [revenue, growth] = await Promise.all([
      this.metrics.revenue(),
      this.metrics.growth(period),
    ]);

    return {
      revenue,
      growth,
      // Shipped alongside so the interface can explain any figure without a
      // second request, and without writing its own version of the wording.
      definitions: this.metrics.definitions(),
    };
  }

  // ── Customers ──────────────────────────────────────────────

  @RequirePlatformPermission('admin.users.read')
  @Get('users')
  async listUsers(
    @Req() req: DmFlowRequest,
    @Query('search') search?: string,
    @Query('status') status?: 'active' | 'suspended' | 'deleted' | 'unverified',
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.users.list(req.platformAdmin!.role, {
      search,
      status,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @RequirePlatformPermission('admin.users.read')
  @Get('users/:id')
  async userDetail(@Req() req: DmFlowRequest, @Param('id') id: string) {
    return this.users.detail(req.platformAdmin!.role, id);
  }

  @RequirePlatformPermission('admin.users.suspend')
  @Post('users/:id/suspend')
  async suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Param('id') id: string,
    @Body(zodBody(z.object({ reason: reasonSchema })))
    body: { reason?: string },
  ) {
    return this.users.suspend({ id: actor.id, role: req.platformAdmin!.role }, id, body.reason ?? '', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @RequirePlatformPermission('admin.users.suspend')
  @Post('users/:id/reactivate')
  async reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Param('id') id: string,
    @Body(zodBody(z.object({ reason: reasonSchema })))
    body: { reason?: string },
  ) {
    return this.users.reactivate(
      { id: actor.id, role: req.platformAdmin!.role },
      id,
      body.reason ?? '',
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  // ── Subscriptions ──────────────────────────────────────────

  @RequirePlatformPermission('admin.subscriptions.read')
  @Get('subscriptions')
  async listSubscriptions(
    @Req() req: DmFlowRequest,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.subscriptions.list(req.platformAdmin!.role, {
      status,
      plan,
      search,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @RequirePlatformPermission('admin.subscriptions.write')
  @Post('subscriptions/:workspaceId/plan')
  async changePlan(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: DmFlowRequest,
    @Param('workspaceId') workspaceId: string,
    @Body(zodBody(z.object({ planCode: z.string().min(1).max(60), reason: reasonSchema })))
    body: { planCode: string; reason?: string },
  ) {
    return this.subscriptions.changePlan(
      { id: actor.id, role: req.platformAdmin!.role },
      workspaceId,
      body.planCode,
      body.reason ?? '',
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  /** The roles that can be granted, for the interface to offer. */
  @RequirePlatformPermission('admin.admins.manage')
  @Get('roles')
  roles() {
    return PLATFORM_ROLES;
  }
}
