import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { TriggerMatcherService } from './trigger-matcher.service';

@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, TriggerMatcherService],
  exports: [AutomationsService, TriggerMatcherService],
})
export class AutomationsModule {}
