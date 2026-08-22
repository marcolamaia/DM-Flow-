import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { WebhooksController } from './webhooks.controller';
import { IngestionController } from './ingestion.controller';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [AutomationsModule],
  controllers: [WebhooksController, IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
