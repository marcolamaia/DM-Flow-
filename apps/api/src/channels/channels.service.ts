import { Injectable } from '@nestjs/common';
import { DmFlowError, randomToken, uuidv7, type Channel } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../common/audit.service';
import { QuotaService } from '../billing/quota.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { SecretBox } from '../common/crypto';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';

const STATE_TTL_SECONDS = 600;

@Injectable()
export class ChannelsService {
  private readonly secretBox = new SecretBox(loadEnv().ENCRYPTION_KEY);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly providers: ProviderRegistry,
  ) {}

  async list(workspaceId: string) {
    const accounts = await this.prisma.connectedAccount.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return accounts.map((a) => ({
      id: a.id,
      channel: a.channel,
      username: a.username,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      accountType: a.accountType,
      status: a.status,
      statusDetail: a.statusDetail,
      isSandbox: a.isSandbox,
      grantedScopes: a.grantedScopes,
      tokenExpiresAt: a.tokenExpiresAt,
      // Days of runway, so the UI can warn before an automation stops working.
      tokenExpiresInDays: a.tokenExpiresAt
        ? Math.max(0, Math.ceil((a.tokenExpiresAt.getTime() - Date.now()) / 86_400_000))
        : null,
      webhookVerifiedAt: a.webhookVerifiedAt,
      lastHealthCheckAt: a.lastHealthCheckAt,
      lastErrorCode: a.lastErrorCode,
      connectedAt: a.createdAt,
    }));
  }

  /** Starts OAuth. State is stored server-side so a forged callback cannot bind an account. */
  async startConnect(workspaceId: string, userId: string, channel: Channel) {
    await this.quota.assertCanConnectAccount(workspaceId);

    const provider = this.providers.forNewConnection(channel);
    const state = randomToken(24);
    const redirectUri = `${loadEnv().API_URL}/channels/callback/${channel.toLowerCase()}`;

    await this.redis.client.set(
      `oauth:${state}`,
      JSON.stringify({ workspaceId, userId, channel }),
      'EX',
      STATE_TTL_SECONDS,
    );

    return {
      authorizationUrl: provider.getAuthorizationUrl({ workspaceId, redirectUri, state }),
      state,
      isSandbox: provider.isSandbox,
    };
  }

  async completeConnect(channel: Channel, code: string, state: string) {
    const raw = await this.redis.client.get(`oauth:${state}`);
    if (!raw) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'state', message: 'authorization state expired or unknown' }],
      });
    }
    await this.redis.client.del(`oauth:${state}`);

    const { workspaceId, userId } = JSON.parse(raw) as { workspaceId: string; userId: string };
    const provider = this.providers.forNewConnection(channel);
    const redirectUri = `${loadEnv().API_URL}/channels/callback/${channel.toLowerCase()}`;

    const draft = await provider.completeAuthorization({ code, state, redirectUri });

    // One external account belongs to exactly one workspace. Letting two workspaces
    // hold the same account would make webhook routing ambiguous and leak messages.
    const clash = await this.prisma.connectedAccount.findUnique({
      where: {
        channel_externalAccountId: {
          channel,
          externalAccountId: draft.externalAccountId,
        },
      },
    });

    if (clash && clash.workspaceId !== workspaceId && !clash.deletedAt) {
      throw new DmFlowError('ALREADY_EXISTS', {
        context: { reason: 'account_connected_elsewhere' },
      });
    }

    const data = {
      workspaceId,
      channel,
      externalAccountId: draft.externalAccountId,
      username: draft.username,
      displayName: draft.displayName,
      avatarUrl: draft.avatarUrl,
      accountType: draft.accountType,
      grantedScopes: draft.grantedScopes,
      accessTokenEnc: this.secretBox.encrypt(draft.accessToken),
      refreshTokenEnc: draft.refreshToken ? this.secretBox.encrypt(draft.refreshToken) : null,
      tokenExpiresAt: draft.tokenExpiresAt ?? null,
      status: 'CONNECTED' as const,
      statusDetail: null,
      isSandbox: draft.isSandbox,
      connectedByUserId: userId,
      deletedAt: null,
      webhookVerifiedAt: new Date(),
    };

    const account = clash
      ? await this.prisma.connectedAccount.update({ where: { id: clash.id }, data })
      : await this.prisma.connectedAccount.create({ data: { id: uuidv7(), ...data } });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'channel.connected',
      entityType: 'ConnectedAccount',
      entityId: account.id,
      after: { channel, username: draft.username, isSandbox: draft.isSandbox },
    });

    logger.info(
      { workspaceId, accountId: account.id, channel, sandbox: draft.isSandbox },
      'channel connected',
    );

    return { accountId: account.id, workspaceId, username: account.username };
  }

  async disconnect(workspaceId: string, userId: string, accountId: string) {
    const account = await this.prisma.connectedAccount.findUnique({ where: { id: accountId } });
    this.prisma.assertTenant(account, workspaceId);

    const provider = this.providers.forAccount(account!.channel, account!.isSandbox);
    if (account!.accessTokenEnc) {
      await provider
        .revoke({ accountId, accessToken: this.secretBox.decrypt(account!.accessTokenEnc) })
        .catch((error) =>
          logger.warn({ accountId, err: String(error) }, 'provider revoke failed, disconnecting anyway'),
        );
    }

    // Tokens are destroyed on disconnect, not merely orphaned.
    await this.prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        status: 'DISCONNECTED',
        deletedAt: new Date(),
        accessTokenEnc: null,
        refreshTokenEnc: null,
      },
    });

    // Automations bound to this account stop, visibly, rather than failing per event.
    const paused = await this.prisma.automation.updateMany({
      where: {
        workspaceId,
        status: 'PUBLISHED',
        triggers: { some: { connectedAccountId: accountId } },
      },
      data: { status: 'PAUSED' },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'channel.disconnected',
      entityType: 'ConnectedAccount',
      entityId: accountId,
      after: { automationsPaused: paused.count },
    });

    return { ok: true, automationsPaused: paused.count };
  }

  /** Health check used by the scheduler and by the settings screen. */
  async checkHealth(workspaceId: string, accountId: string) {
    const account = await this.prisma.connectedAccount.findUnique({ where: { id: accountId } });
    this.prisma.assertTenant(account, workspaceId);

    if (!account!.accessTokenEnc) {
      return this.persistHealth(accountId, 'TOKEN_INVALID', 'no stored credentials');
    }

    const provider = this.providers.forAccount(account!.channel, account!.isSandbox);
    try {
      const health = await provider.getAccountHealth({
        accountId,
        accessToken: this.secretBox.decrypt(account!.accessTokenEnc),
      });

      const expiringSoon =
        health.tokenExpiresAt !== null &&
        health.tokenExpiresAt !== undefined &&
        health.tokenExpiresAt.getTime() - Date.now() < 7 * 86_400_000;

      const status = !health.webhookHealthy
        ? 'WEBHOOK_UNHEALTHY'
        : expiringSoon
          ? 'TOKEN_EXPIRING'
          : 'CONNECTED';

      return this.persistHealth(accountId, status, health.detail, health.tokenExpiresAt);
    } catch (error) {
      return this.persistHealth(
        accountId,
        'PROVIDER_ERROR',
        error instanceof Error ? error.message : 'unknown provider error',
      );
    }
  }

  private async persistHealth(
    accountId: string,
    status: string,
    detail?: string | null,
    tokenExpiresAt?: Date | null,
  ) {
    const account = await this.prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        status: status as never,
        statusDetail: detail ?? null,
        lastHealthCheckAt: new Date(),
        ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
      },
    });
    return { status: account.status, statusDetail: account.statusDetail, checkedAt: account.lastHealthCheckAt };
  }

  /** Decrypts a token for provider use. Never returned through the API. */
  async accessTokenFor(accountId: string): Promise<string> {
    const account = await this.prisma.connectedAccount.findUnique({ where: { id: accountId } });
    if (!account?.accessTokenEnc) {
      throw new DmFlowError('PROVIDER_TOKEN_INVALID', { context: { accountId } });
    }
    return this.secretBox.decrypt(account.accessTokenEnc);
  }
}
