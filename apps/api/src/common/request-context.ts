import type { Request } from 'express';
import type { MemberRole, Locale } from '@dmflow/shared';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  locale: Locale;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  status: string;
  role: MemberRole;
  planCode: string;
  features: Set<string>;
}

export interface DmFlowRequest extends Request {
  user?: AuthenticatedUser;
  sessionId?: string;
  workspace?: WorkspaceContext;
  rawBody?: Buffer;
}
