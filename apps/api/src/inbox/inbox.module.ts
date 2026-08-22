import { Module } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxGateway } from './inbox.gateway';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [ChannelsModule],
  controllers: [InboxController],
  providers: [InboxService, InboxGateway],
  exports: [InboxService, InboxGateway],
})
export class InboxModule {}
