import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { SandboxController } from './sandbox.controller';

@Module({
  controllers: [ChannelsController, SandboxController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
