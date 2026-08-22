import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { predicateSchema, type CustomFieldType, type PredicateNode } from '@dmflow/shared';
import { TaxonomyService } from './taxonomy.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex colour like #6366f1');

@Controller()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  // ── Tags
  @RequirePermission('tag:read')
  @Get('tags')
  listTags(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.taxonomy.listTags(ws.id);
  }

  @RequirePermission('tag:manage')
  @Post('tags')
  createTag(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(80),
          color: hexColor.optional(),
          description: z.string().max(300).optional(),
        }),
      ),
    )
    body: { name: string; color?: string; description?: string },
  ) {
    return this.taxonomy.createTag(ws.id, user.id, body);
  }

  @RequirePermission('tag:manage')
  @Patch('tags/:id')
  updateTag(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(80).optional(),
          color: hexColor.optional(),
          description: z.string().max(300).optional(),
        }),
      ),
    )
    body: { name?: string; color?: string; description?: string },
  ) {
    return this.taxonomy.updateTag(ws.id, user.id, id, body);
  }

  @RequirePermission('tag:manage')
  @Delete('tags/:id')
  deleteTag(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.taxonomy.deleteTag(ws.id, user.id, id);
  }

  // ── Custom fields
  @RequirePermission('custom_field:read')
  @Get('custom-fields')
  listFields(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.taxonomy.listCustomFields(ws.id);
  }

  @RequirePermission('custom_field:manage')
  @Post('custom-fields')
  createField(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          key: z.string().min(1).max(60),
          label: z.string().min(1).max(120),
          type: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT']),
          options: z.array(z.string().max(120)).max(50).optional(),
        }),
      ),
    )
    body: { key: string; label: string; type: CustomFieldType; options?: string[] },
  ) {
    return this.taxonomy.createCustomField(ws.id, user.id, body);
  }

  @RequirePermission('custom_field:manage')
  @Delete('custom-fields/:id')
  deleteField(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.taxonomy.deleteCustomField(ws.id, user.id, id);
  }

  // ── Segments
  @RequirePermission('segment:read')
  @Get('segments')
  listSegments(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.taxonomy.listSegments(ws.id);
  }

  @RequirePermission('segment:manage')
  @Post('segments')
  createSegment(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(120),
          description: z.string().max(300).optional(),
          filter: predicateSchema,
        }),
      ),
    )
    body: { name: string; description?: string; filter: PredicateNode },
  ) {
    return this.taxonomy.createSegment(ws.id, user.id, body);
  }

  @RequirePermission('segment:manage')
  @Patch('segments/:id')
  updateSegment(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          name: z.string().min(1).max(120).optional(),
          description: z.string().max(300).optional(),
          filter: predicateSchema.optional(),
        }),
      ),
    )
    body: { name?: string; description?: string; filter?: PredicateNode },
  ) {
    return this.taxonomy.updateSegment(ws.id, user.id, id, body);
  }

  @RequirePermission('segment:manage')
  @Delete('segments/:id')
  deleteSegment(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.taxonomy.deleteSegment(ws.id, user.id, id);
  }

  /** Preview a filter's size before saving it as a segment. */
  @RequirePermission('segment:read')
  @Post('segments/preview')
  preview(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(zodBody(z.object({ filter: predicateSchema }))) body: { filter: PredicateNode },
  ) {
    return this.taxonomy.countSegment(ws.id, body.filter).then((count) => ({ count }));
  }
}
