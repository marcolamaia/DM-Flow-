import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';

@Module({
  controllers: [ContactsController, TaxonomyController],
  providers: [ContactsService, TaxonomyService],
  exports: [ContactsService, TaxonomyService],
})
export class ContactsModule {}
