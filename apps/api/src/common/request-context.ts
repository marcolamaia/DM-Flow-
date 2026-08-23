import type { Request } from 'express';
import type { Locale, MemberRole, PlatformRole } from '@dmflow/shared';

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
  /**
   * Set only on administrative routes, by AdminGuard, from a grant in the
   * database. Separate from `workspace.role`: operating the platform and being
   * an owner of one workspace are different things.
   */
  platformAdmin?: { role: PlatformRole; grantId: string };
  rawBody?: Buffer;
}
