import { Body, Controller, Headers, Post } from '@nestjs/common';
import { z } from 'zod';
import { CHANNELS, DmFlowError, uuidv7, type Channel } from '@dmflow/shared';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { QuotaService } from '../billing/quota.service';
import { zodBody } from '../common/zod.pipe';
import { Public } from '../common/decorators/permissions.decorator';
import { PUBLIC_API_LIMIT, RateLimit } from '../common/decorators/rate-limit.decorator';

/**
 * Public API for customers' own systems.
 *
 * Authenticated by API key rather than session, and deliberately narrow: it can
 * create a contact and start an automation. It cannot send a message directly,
 * because sending must always pass through the capability engine inside a flow —
 * exposing a raw send endpoint would be a way around every window rule.
 */
@Public()
@RateLimit(PUBLIC_API_LIMIT)
@Controller('v1')
export class PublicApiController {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly quota: QuotaService,
  ) {}

  private async authorize(header: string | undefined, scope: string) {
    const raw = header?.startsWith('Bearer ') ? header.slice(7) : header;
    if (!raw) throw new DmFlowError('NOT_AUTHENTICATED');

    const { workspaceId, scopes } = await this.apiKeys.authenticate(raw);

    if (scopes.length > 0 && !scopes.includes(scope)) {
      throw new DmFlowError('FORBIDDEN', { context: { scope } });
    }

    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (workspace?.status === 'SUSPENDED') throw new DmFlowError('WORKSPACE_SUSPENDED');

    return workspaceId;
  }

  @Post('contacts')
  async createContact(
    @Headers('authorization') auth: string | undefined,
    @Body(
      zodBody(
        z.object({
          displayName: z.string().max(200).optional(),
          username: z.string().max(200).optional(),
          channel: z.enum(CHANNELS).default('INSTAGRAM'),
          externalUserId: z.string().max(200).optional(),
        }),
      ),
    )
    body: { displayName?: string; username?: string; channel: Channel; externalUserId?: string },
  ) {
    const workspaceId = await this.authorize(auth, 'contacts:write');
    await this.quota.assertCanAddContact(workspaceId);

    const contact = await this.prisma.contact.create({
      data: {
        id: uuidv7(),
        workspaceId,
        primaryChannel: body.channel,
        displayName: body.displayName,
        username: body.username,
        source: 'api',
      },
    });

    return { id: contact.id, createdAt: contact.createdAt };
  }

  /** Starts an automation for a contact — the inbound_api trigger path. */
  @Post('automations/trigger')
  async trigger(
    @Headers('authorization') auth: string | undefined,
    @Body(
      zodBody(
        z.object({
          automationId: z.string().min(1).max(64),
          contactId: z.string().min(1).max(64),
          variables: z.record(z.unknown()).optional(),
        }),
      ),
    )
    body: { automationId: string; contactId: string; variables?: Record<string, unknown> },
  ) {
    const workspaceId = await this.authorize(auth, 'automations:trigger');

    const contact = await this.prisma.contact.findUnique({ where: { id: body.contactId } });
    this.prisma.assertTenant(contact, workspaceId);

    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId: body.contactId, workspaceId },
      orderBy: { lastInboundAt: 'desc' },
    });

    const result = await this.engine.start({
      workspaceId,
      automationId: body.automationId,
      contactId: body.contactId,
      conversationId: conversation?.id ?? null,
      connectedAccountId: conversation?.connectedAccountId ?? null,
      variables: body.variables ?? {},
      origin: { triggerType: 'inbound_api', eventType: 'api' },
    });

    return 'executionId' in result
      ? { started: true, executionId: result.executionId }
      : { started: false, reason: result.skipped };
  }
}
