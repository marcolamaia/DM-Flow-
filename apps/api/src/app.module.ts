import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ContactsModule } from './contacts/contacts.module';
import { CapabilityModule } from './capabilities/capability.module';
import { ProvidersModule } from './providers/providers.module';
import { ChannelsModule } from './channels/channels.module';
import { AutomationsModule } from './automations/automations.module';
import { EngineModule } from './engine/engine.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { ExecutionsModule } from './executions/executions.module';
import { InboxModule } from './inbox/inbox.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { HealthController } from './health/health.controller';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { RateLimitMiddleware } from './common/rate-limit.middleware';

@Module({
  imports: [PrismaModule, RedisModule, CommonModule, BillingModule, AuthModule, WorkspaceModule, ContactsModule, CapabilityModule, ProvidersModule, ChannelsModule, AutomationsModule, EngineModule, IngestionModule, ExecutionsModule, InboxModule, AnalyticsModule, IntegrationsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation first so a throttled request still carries an id in the logs.
    consumer.apply(CorrelationMiddleware, RateLimitMiddleware).forRoutes('*');
  }
}
