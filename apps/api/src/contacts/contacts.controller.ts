import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CHANNELS, predicateSchema, type Channel } from '@dmflow/shared';
import { ContactsService } from './contacts.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'UNSUBSCRIBED', 'BLOCKED']).optional(),
  channel: z.enum(CHANNELS).optional(),
  tagIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : v.split(','))),
  segmentId: z.string().max(64).optional(),
  sort: z.enum(['recent', 'created', 'name']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @RequirePermission('contact:read')
  @Get()
  async list(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(zodBody(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.contacts.list(ws.id, query);
  }

  @RequirePermission('contact:read')
  @Post('search')
  async search(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(
      zodBody(
        listQuerySchema.extend({ predicate: predicateSchema.optional() }).omit({ tagIds: true }).extend({
          tagIds: z.array(z.string()).optional(),
        }),
      ),
    )
    body: z.infer<typeof listQuerySchema> & { predicate?: unknown },
  ) {
    return this.contacts.list(ws.id, body as never);
  }

  @RequirePermission('contact:read')
  @Get(':id')
  async get(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.contacts.get(ws.id, id);
  }

  @RequirePermission('contact:create')
  @Post()
  async create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          displayName: z.string().max(200).optional(),
          username: z.string().max(200).optional(),
          primaryChannel: z.enum(CHANNELS).default('INSTAGRAM'),
          locale: z.string().max(10).optional(),
        }),
      ),
    )
    body: { displayName?: string; username?: string; primaryChannel: Channel; locale?: string },
  ) {
    return this.contacts.create(ws.id, user.id, body);
  }

  @RequirePermission('contact:update')
  @Patch(':id')
  async update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          displayName: z.string().max(200).optional(),
          username: z.string().max(200).optional(),
          locale: z.string().max(10).optional(),
          status: z.enum(['ACTIVE', 'UNSUBSCRIBED', 'BLOCKED']).optional(),
        }),
      ),
    )
    body: { displayName?: string; username?: string; locale?: string; status?: string },
  ) {
    return this.contacts.update(ws.id, user.id, id, body);
  }

  @RequirePermission('contact:delete')
  @Delete(':id')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.contacts.remove(ws.id, user.id, id);
  }

  @RequirePermission('contact:update')
  @Post(':id/tags/:tagId')
  async addTag(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contacts.addTag(ws.id, id, tagId, { userId: user.id });
  }

  @RequirePermission('contact:update')
  @Delete(':id/tags/:tagId')
  async removeTag(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contacts.removeTag(ws.id, id, tagId);
  }

  @RequirePermission('contact:update')
  @Put(':id/fields/:fieldId')
  async setField(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @Body(zodBody(z.object({ value: z.unknown() }))) body: { value: unknown },
  ) {
    return this.contacts.setFieldValue(ws.id, id, fieldId, body.value);
  }

  @RequirePermission('contact:update')
  @Delete(':id/fields/:fieldId')
  async clearField(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
  ) {
    return this.contacts.clearFieldValue(ws.id, id, fieldId);
  }

  @RequirePermission('contact:update')
  @Post('bulk/tag')
  async bulkTag(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ contactIds: z.array(z.string()).min(1).max(1000), tagId: z.string() })))
    body: { contactIds: string[]; tagId: string },
  ) {
    return this.contacts.bulkTag(ws.id, body.contactIds, body.tagId, user.id);
  }

  @RequirePermission('contact:export')
  @Post('export')
  async export(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(zodBody(z.object({ contactIds: z.array(z.string()).max(5000).optional() })))
    body: { contactIds?: string[] },
  ) {
    return this.contacts.export(ws.id, body.contactIds);
  }

  @RequirePermission('contact:import')
  @Post('import')
  async import(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          rows: z
            .array(
              z.object({
                displayName: z.string().max(200).optional(),
                username: z.string().max(200).optional(),
                channel: z.enum(CHANNELS).optional(),
                tags: z.array(z.string().max(80)).max(20).optional(),
              }),
            )
            .min(1)
            .max(2000),
        }),
      ),
    )
    body: { rows: Array<{ displayName?: string; username?: string; channel?: string; tags?: string[] }> },
  ) {
    return this.contacts.import(ws.id, user.id, body.rows);
  }

  @RequirePermission('contact:update')
  @Post('merge')
  async merge(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ primaryId: z.string(), duplicateId: z.string() })))
    body: { primaryId: string; duplicateId: string },
  ) {
    return this.contacts.merge(ws.id, user.id, body.primaryId, body.duplicateId);
  }
}
