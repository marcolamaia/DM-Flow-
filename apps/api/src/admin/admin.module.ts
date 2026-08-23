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
import { BillingModule } from '../billing/billing.module';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminFinanceService } from './admin-finance.service';
import { AdminWebhooksService } from './admin-webhooks.service';

/**
 * Global so that any service can record a domain event without importing the
 * admin module — the events are facts about the platform, not something the
 * admin panel owns.
 */
@Global()
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [
    AdminController,
    MetricsController,
    AdminOverviewController,
    AdminFinanceController,
  ],
  providers: [
    AdminGuard,
    AdminAuditService,
    DomainEventsService,
    MetricsService,
    AdminUsersService,
    AdminSubscriptionsService,
    AdminFinanceService,
    AdminWebhooksService,
  ],
  exports: [DomainEventsService, AdminAuditService, MetricsService],
})
export class AdminModule {}
