import { Global, Module } from '@nestjs/common';
import { EngineService } from './engine.service';
import { NodeExecutorsService } from './node-executors.service';
import { QueueService } from './queue.service';
import { ChannelsModule } from '../channels/channels.module';
import { ContactsModule } from '../contacts/contacts.module';

@Global()
@Module({
  imports: [ChannelsModule, ContactsModule],
  providers: [EngineService, NodeExecutorsService, QueueService],
  exports: [EngineService, NodeExecutorsService, QueueService],
})
export class EngineModule {}
