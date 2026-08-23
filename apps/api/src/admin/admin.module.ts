import { Global, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminAuditService } from './admin-audit.service';
import { DomainEventsService } from './domain-events.service';

/**
 * Global so that any service can record a domain event without importing the
 * admin module — the events are facts about the platform, not something the
 * admin panel owns.
 */
@Global()
@Module({
  controllers: [AdminController],
  providers: [AdminGuard, AdminAuditService, DomainEventsService],
  exports: [DomainEventsService, AdminAuditService],
})
export class AdminModule {}
