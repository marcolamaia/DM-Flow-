import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@dmflow/db';
import { DmFlowError } from '@dmflow/shared';
import { logger } from '../common/logger';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // @ts-expect-error prisma event typings are looser than the emitter
    this.$on('warn', (e: { message: string }) => logger.warn({ prisma: e.message }, 'prisma warn'));
    // @ts-expect-error see above
    this.$on('error', (e: { message: string }) => logger.error({ prisma: e.message }, 'prisma error'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Guards against the classic multi-tenant leak: a row fetched by id alone and
   * then used without checking it belongs to the caller's workspace. Every
   * single-row lookup that came from a client-supplied id runs through this.
   */
  assertTenant<T extends { workspaceId: string | null } | null>(
    row: T,
    workspaceId: string,
  ): NonNullable<T> {
    if (!row) throw new DmFlowError('NOT_FOUND');
    if (row.workspaceId !== workspaceId) {
      // Deliberately reported as NOT_FOUND: telling a caller that a resource exists
      // in another workspace is itself a disclosure.
      throw new DmFlowError('NOT_FOUND', { context: { reason: 'tenant_mismatch' } });
    }
    return row as NonNullable<T>;
  }
}
