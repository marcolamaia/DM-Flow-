import { Global, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminAuditService } from './admin-audit.service';
import { DomainEventsService } from './domain-events.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Global so that any service can record a domain event without importing the
 * admin module — the events are facts about the platform, not something the
 * admin panel owns.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AdminController, MetricsController, AdminOverviewController],
  providers: [
    AdminGuard,
    AdminAuditService,
    DomainEventsService,
    MetricsService,
    AdminUsersService,
    AdminSubscriptionsService,
  ],
  exports: [DomainEventsService, AdminAuditService, MetricsService],
})
export class AdminModule {}
