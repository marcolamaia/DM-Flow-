import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@dmflow/shared';

export const PERMISSION_KEY = 'dmflow:permission';
export const PUBLIC_KEY = 'dmflow:public';
export const NO_WORKSPACE_KEY = 'dmflow:no-workspace';

/** Routes are authenticated by default; opting out has to be explicit and visible. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Authenticated, but not scoped to a workspace (e.g. listing your workspaces). */
export const NoWorkspace = () => SetMetadata(NO_WORKSPACE_KEY, true);

export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
