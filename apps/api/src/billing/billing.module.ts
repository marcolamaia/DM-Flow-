import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';
import { StripeClient } from './stripe.client';

@Global()
@Module({
  controllers: [BillingController],
  providers: [QuotaService, BillingService, StripeClient],
  exports: [QuotaService, BillingService, StripeClient],
})
export class BillingModule {}
