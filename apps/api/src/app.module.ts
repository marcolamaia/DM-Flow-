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
import { HealthController } from './health/health.controller';
import { CorrelationMiddleware } from './common/correlation.middleware';

@Module({
  imports: [PrismaModule, RedisModule, CommonModule, BillingModule, AuthModule, WorkspaceModule, ContactsModule, CapabilityModule, ProvidersModule, ChannelsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
