import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditService } from './audit.service';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitMiddleware } from './rate-limit.middleware';

/**
 * Registered here rather than alongside authentication so that it is instantiated
 * first: CommonModule is imported before AuthModule, and Nest runs global guards
 * in that order. Rate limiting has to reject a flood before authentication starts
 * spending database queries on it.
 */
@Global()
@Module({
  providers: [
    AuditService,
    RateLimitService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    RateLimitMiddleware,
  ],
  exports: [AuditService, RateLimitService, RateLimitMiddleware],
})
export class CommonModule {}
