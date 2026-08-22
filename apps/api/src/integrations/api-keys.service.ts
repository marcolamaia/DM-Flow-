import { Injectable } from '@nestjs/common';
import { DmFlowError, randomToken, uuidv7 } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { QuotaService } from '../billing/quota.service';
import { hashToken } from '../common/crypto';

const KEY_PREFIX = 'dmf_';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
  ) {}

  async list(workspaceId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { workspaceId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      // Only the prefix is ever shown again — the key itself exists once.
      prefix: k.prefix,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  }

  async create(workspaceId: string, userId: string, name: string, scopes: string[]) {
    await this.quota.assertFeature(workspaceId, 'public_api');

    const raw = `${KEY_PREFIX}${randomToken(24)}`;
    const key = await this.prisma.apiKey.create({
      data: {
        id: uuidv7(),
        workspaceId,
        name: name.trim(),
        keyHash: hashToken(raw),
        prefix: raw.slice(0, 12),
        scopes,
        createdById: userId,
      },
    });

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'api_key.created',
      entityType: 'ApiKey',
      entityId: key.id,
      after: { name, scopes },
    });

    return { id: key.id, key: raw, prefix: key.prefix };
  }

  async revoke(workspaceId: string, userId: string, id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    this.prisma.assertTenant(key, workspaceId);

    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'api_key.revoked',
      entityType: 'ApiKey',
      entityId: id,
    });
    return { ok: true };
  }

  /** Resolves a presented key. Returns the workspace it authorises, or throws. */
  async authenticate(rawKey: string): Promise<{ workspaceId: string; scopes: string[] }> {
    if (!rawKey.startsWith(KEY_PREFIX)) throw new DmFlowError('NOT_AUTHENTICATED');

    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashToken(rawKey) } });
    if (!key || key.revokedAt) throw new DmFlowError('NOT_AUTHENTICATED');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw new DmFlowError('NOT_AUTHENTICATED', { context: { reason: 'expired' } });
    }

    // Recorded so an unused key can be spotted and revoked.
    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return { workspaceId: key.workspaceId, scopes: key.scopes };
  }
}
