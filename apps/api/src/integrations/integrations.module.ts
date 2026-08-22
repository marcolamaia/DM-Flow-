import { Global, Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { PublicApiController } from './public-api.controller';
import { TemplatesService } from './templates.service';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { ApiKeysService } from './api-keys.service';

@Global()
@Module({
  controllers: [IntegrationsController, PublicApiController],
  providers: [TemplatesService, OutboundWebhooksService, ApiKeysService],
  exports: [TemplatesService, OutboundWebhooksService, ApiKeysService],
})
export class IntegrationsModule {}
