import { SetMetadata } from '@nestjs/common';
import type { PlatformPermission } from '@dmflow/shared';

export const ADMIN_PERMISSION_KEY = 'dmflow:admin-permission';

/**
 * Declares what an administrative route requires.
 *
 * Not optional: AdminGuard refuses a route that declares nothing, so forgetting
 * this locks the door rather than leaving it open.
 */
export const RequirePlatformPermission = (permission: PlatformPermission) =>
  SetMetadata(ADMIN_PERMISSION_KEY, permission);
