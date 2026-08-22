import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { loadEnv } from '../config/env';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  async ready() {
    const [db, cache] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);
    const ready = db.status === 'fulfilled' && cache.status === 'fulfilled';
    return {
      status: ready ? 'ok' : 'degraded',
      checks: { database: db.status, redis: cache.status },
    };
  }

  /** Deep check also reports what the platform can and cannot currently do. */
  @Get('deep')
  async deep() {
    const env = loadEnv();
    const [workspaces, pendingEvents] = await Promise.all([
      this.prisma.workspace.count(),
      this.prisma.webhookEvent.count({ where: { status: { in: ['RECEIVED', 'PROCESSING'] } } }),
    ]);
    return {
      status: 'ok',
      environment: env.NODE_ENV,
      instagramProvider: env.INSTAGRAM_PROVIDER,
      billingConfigured: env.STRIPE_SECRET_KEY.length > 0,
      workspaces,
      pendingWebhookEvents: pendingEvents,
    };
  }
}
