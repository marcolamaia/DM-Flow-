import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DmFlowError } from '@dmflow/shared';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { NoWorkspace, Public, RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, DmFlowRequest, WorkspaceContext } from '../common/request-context';
import { logger } from '../common/logger';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly quota: QuotaService,
  ) {}

  @NoWorkspace()
  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @RequirePermission('billing:read')
  @Get('subscription')
  subscription(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.billing.getSubscription(ws.id);
  }

  @RequirePermission('billing:read')
  @Get('usage')
  usage(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.quota.snapshot(ws.id);
  }

  @RequirePermission('billing:manage')
  @Post('checkout')
  checkout(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ planCode: z.string().min(1).max(40) })))
    body: { planCode: string },
  ) {
    return this.billing.createCheckout(ws.id, user.id, body.planCode);
  }

  @RequirePermission('billing:manage')
  @Post('portal')
  portal(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.billing.createPortalSession(ws.id);
  }

  /**
   * Stripe posts here. Public by necessity, authenticated by signature over the
   * raw bytes — never by a session.
   */
  @Public()
  @Post('stripe/webhook')
  @HttpCode(200)
  async webhook(@Req() req: DmFlowRequest, @Res() res: Response) {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'missing signature' });
      return;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      // Without the exact bytes there is nothing trustworthy to verify.
      res.status(400).json({ error: 'raw body unavailable' });
      return;
    }

    try {
      const result = await this.billing.handleWebhook(rawBody, signature);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof DmFlowError && error.code === 'STRIPE_SIGNATURE_INVALID') {
        res.status(400).json({ error: error.code });
        return;
      }
      // Stripe retries on non-2xx, which is what we want for a transient failure.
      logger.error({ err: (error as Error).message }, 'stripe webhook handling failed');
      res.status(500).json({ error: 'processing_failed' });
    }
  }
}
