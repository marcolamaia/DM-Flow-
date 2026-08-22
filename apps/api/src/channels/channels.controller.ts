import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CHANNELS, type Channel } from '@dmflow/shared';
import { ChannelsService } from './channels.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, CurrentWorkspace } from '../common/decorators/current-user.decorator';
import { Public, RequirePermission } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser, WorkspaceContext } from '../common/request-context';
import { loadEnv } from '../config/env';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @RequirePermission('channel:read')
  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.channels.list(ws.id);
  }

  @RequirePermission('channel:connect')
  @Post('connect')
  connect(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ channel: z.enum(CHANNELS).default('INSTAGRAM') })))
    body: { channel: Channel },
  ) {
    return this.channels.startConnect(ws.id, user.id, body.channel);
  }

  /**
   * OAuth callback. Public because the provider redirects the browser here without
   * our session cookie guaranteed; the stored state is what authorises the binding.
   */
  @Public()
  @Get('callback/:channel')
  async callback(
    @Param('channel') channel: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const normalized = channel.toUpperCase() as Channel;
    try {
      const result = await this.channels.completeConnect(normalized, code, state);
      res.redirect(
        `${loadEnv().WEB_URL}/settings/channels?connected=${encodeURIComponent(result.username)}`,
      );
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'CONNECT_FAILED';
      res.redirect(`${loadEnv().WEB_URL}/settings/channels?error=${encodeURIComponent(code)}`);
    }
  }

  @RequirePermission('channel:read')
  @Post(':id/health')
  health(@CurrentWorkspace() ws: WorkspaceContext, @Param('id') id: string) {
    return this.channels.checkHealth(ws.id, id);
  }

  @RequirePermission('channel:disconnect')
  @Delete(':id')
  disconnect(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.channels.disconnect(ws.id, user.id, id);
  }
}
