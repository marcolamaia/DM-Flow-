import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DmFlowError } from '@dmflow/shared';
import type { AuthenticatedUser, DmFlowRequest, WorkspaceContext } from '../request-context';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<DmFlowRequest>();
    if (!req.user) throw new DmFlowError('NOT_AUTHENTICATED');
    return req.user;
  },
);

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const req = ctx.switchToHttp().getRequest<DmFlowRequest>();
    if (!req.workspace) throw new DmFlowError('WORKSPACE_ACCESS_DENIED');
    return req.workspace;
  },
);

export const ClientInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { ip: string; userAgent: string } => {
    const req = ctx.switchToHttp().getRequest<DmFlowRequest>();
    return {
      ip: req.ip ?? '',
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    };
  },
);
