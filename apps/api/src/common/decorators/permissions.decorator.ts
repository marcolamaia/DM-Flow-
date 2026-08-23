import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@dmflow/shared';

export const PERMISSION_KEY = 'dmflow:permission';
export const PUBLIC_KEY = 'dmflow:public';
export const NO_WORKSPACE_KEY = 'dmflow:no-workspace';
export const VERIFIED_EMAIL_KEY = 'dmflow:verified-email';

/** Routes are authenticated by default; opting out has to be explicit and visible. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Authenticated, but not scoped to a workspace (e.g. listing your workspaces). */
export const NoWorkspace = () => SetMetadata(NO_WORKSPACE_KEY, true);

export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Requires a confirmed email address.
 *
 * Reserved for the actions that make the account act on the outside world.
 * Anyone can sign up claiming an address they do not own; what must not follow
 * from that is connecting a channel or publishing an automation under it.
 * Everything else stays open, so an unconfirmed account can still look around
 * rather than being locked out of a product it just paid attention to.
 */
export const RequireVerifiedEmail = () => SetMetadata(VERIFIED_EMAIL_KEY, true);
