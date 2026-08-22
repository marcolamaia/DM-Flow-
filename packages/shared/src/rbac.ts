export const MEMBER_ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'AGENT', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Permissions are explicit strings, not role checks scattered through code.
 * Adding a permission means adding it here and to every role that should have it —
 * which forces the "who can do this?" question to be answered once, in one place.
 */
export const PERMISSIONS = [
  // workspace
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer_ownership',
  // members
  'member:read',
  'member:invite',
  'member:update_role',
  'member:remove',
  // billing
  'billing:read',
  'billing:manage',
  // channels
  'channel:read',
  'channel:connect',
  'channel:disconnect',
  // contacts
  'contact:read',
  'contact:create',
  'contact:update',
  'contact:delete',
  'contact:export',
  'contact:import',
  // segmentation
  'tag:read',
  'tag:manage',
  'custom_field:read',
  'custom_field:manage',
  'segment:read',
  'segment:manage',
  // automations
  'automation:read',
  'automation:create',
  'automation:update',
  'automation:publish',
  'automation:delete',
  'automation:run_test',
  // executions
  'execution:read',
  'execution:cancel',
  // inbox
  'inbox:read',
  'inbox:send',
  'inbox:assign',
  'inbox:note',
  'inbox:change_status',
  // analytics
  'analytics:read',
  // integrations
  'integration:read',
  'integration:manage',
  'api_key:manage',
  'webhook:manage',
  // governance
  'audit:read',
  'template:read',
  'template:manage',
  'dsr:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const ADMIN: Permission[] = ALL.filter(
  (p) => p !== 'workspace:delete' && p !== 'workspace:transfer_ownership',
);

const EDITOR: Permission[] = [
  'workspace:read',
  'member:read',
  'channel:read',
  'contact:read',
  'contact:create',
  'contact:update',
  'contact:delete',
  'contact:export',
  'contact:import',
  'tag:read',
  'tag:manage',
  'custom_field:read',
  'custom_field:manage',
  'segment:read',
  'segment:manage',
  'automation:read',
  'automation:create',
  'automation:update',
  'automation:publish',
  'automation:delete',
  'automation:run_test',
  'execution:read',
  'execution:cancel',
  'inbox:read',
  'inbox:send',
  'inbox:assign',
  'inbox:note',
  'inbox:change_status',
  'analytics:read',
  'integration:read',
  'template:read',
  'template:manage',
];

const AGENT: Permission[] = [
  'workspace:read',
  'member:read',
  'channel:read',
  'contact:read',
  'contact:update',
  'tag:read',
  'custom_field:read',
  'segment:read',
  'automation:read',
  'execution:read',
  'inbox:read',
  'inbox:send',
  'inbox:assign',
  'inbox:note',
  'inbox:change_status',
];

const VIEWER: Permission[] = [
  'workspace:read',
  'member:read',
  'channel:read',
  'contact:read',
  'tag:read',
  'custom_field:read',
  'segment:read',
  'automation:read',
  'execution:read',
  'inbox:read',
  'analytics:read',
  'integration:read',
  'template:read',
];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: ADMIN,
  EDITOR: EDITOR,
  AGENT: AGENT,
  VIEWER: VIEWER,
};

export function roleHasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: MemberRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/**
 * Actions still allowed while a workspace is SUSPENDED for non-payment.
 * The rule: reading and paying stay open, changing and sending do not.
 * Suspension must never look like data loss.
 */
const SUSPENDED_ALLOWED: readonly Permission[] = [
  'workspace:read',
  'member:read',
  'billing:read',
  'billing:manage',
  'channel:read',
  'contact:read',
  'contact:export',
  'tag:read',
  'custom_field:read',
  'segment:read',
  'automation:read',
  'execution:read',
  'inbox:read',
  'analytics:read',
  'integration:read',
  'template:read',
  'audit:read',
];

export function isPermittedWhileSuspended(permission: Permission): boolean {
  return SUSPENDED_ALLOWED.includes(permission);
}
