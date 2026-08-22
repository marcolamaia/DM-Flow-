import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CHANNELS, type Channel } from '@dmflow/shared';
import { IngestionService } from './ingestion.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { Public } from '../common/decorators/permissions.decorator';
import { RateLimit, WEBHOOK_LIMIT } from '../common/decorators/rate-limit.decorator';
import type { DmFlowRequest } from '../common/request-context';
import { logger } from '../common/logger';

@Public()
@RateLimit(WEBHOOK_LIMIT)
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly providers: ProviderRegistry,
  ) {}

  /** Subscription handshake. */
  @Get(':channel')
  verify(
    @Param('channel') channel: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const normalized = this.normalizeChannel(channel);
    if (!normalized) {
      res.status(404).send('unknown channel');
      return;
    }

    const provider = this.providers.forNewConnection(normalized);
    const challenge = provider.handleVerificationChallenge(query);

    if (challenge === null) {
      res.status(403).send('verification failed');
      return;
    }
    res.status(200).send(challenge);
  }

  /**
   * Always answers 200 once the signature checks out, even if enqueueing fails:
   * the event is already persisted, and a non-200 would make the platform retry
   * something we successfully stored.
   */
  @Post(':channel')
  @HttpCode(200)
  async receive(
    @Param('channel') channel: string,
    @Req() req: DmFlowRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const normalized = this.normalizeChannel(channel);
    if (!normalized) {
      res.status(404).json({ error: 'unknown channel' });
      return;
    }

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    try {
      const result = await this.ingestion.receive(normalized, rawBody, signature, body);
      if (!result.accepted) {
        res.status(401).json({ error: result.reason });
        return;
      }
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), channel },
        'webhook receive failed after signature check',
      );
      res.status(200).json({ received: true, deferred: true });
    }
  }

  private normalizeChannel(value: string): Channel | null {
    const upper = value.toUpperCase();
    return (CHANNELS as readonly string[]).includes(upper) ? (upper as Channel) : null;
  }
}
