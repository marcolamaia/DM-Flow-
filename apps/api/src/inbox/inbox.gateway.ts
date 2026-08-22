import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService, SESSION_COOKIE } from '../auth/session.service';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';

/**
 * Realtime inbox updates.
 *
 * Rooms are per workspace, and joining one requires a real session plus a real
 * membership — a socket connection is not a back door around the HTTP guards.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: [loadEnv().WEB_URL], credentials: true },
  path: '/realtime',
})
export class InboxGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.readSessionCookie(client.handshake.headers.cookie);
      const workspaceId = String(client.handshake.query.workspaceId ?? '');
      if (!token || !workspaceId) {
        client.disconnect(true);
        return;
      }

      const { userId } = await this.sessions.resolve(token);
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!membership) {
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;
      client.data.workspaceId = workspaceId;
      await client.join(`ws:${workspaceId}`);
      client.emit('ready', { workspaceId });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    logger.debug({ socketId: client.id }, 'realtime client disconnected');
  }

  emitMessage(workspaceId: string, conversationId: string, message: unknown): void {
    this.server?.to(`ws:${workspaceId}`).emit('message:new', { conversationId, message });
  }

  emitConversationUpdate(workspaceId: string, conversation: unknown): void {
    this.server?.to(`ws:${workspaceId}`).emit('conversation:updated', { conversation });
  }

  emitExecutionUpdate(workspaceId: string, execution: unknown): void {
    this.server?.to(`ws:${workspaceId}`).emit('execution:updated', { execution });
  }

  private readSessionCookie(header: string | undefined): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
    }
    return null;
  }
}
