import type { LocalizedMessage } from './locale.js';

/**
 * Who may operate the platform itself.
 *
 * Deliberately separate from MemberRole. Being an OWNER of your own workspace
 * says nothing about being allowed to read another customer's billing, and
 * conflating the two is how a normal user ends up one boolean away from seeing
 * every account on the platform.
 *
 * Membership of this set is a row in its own table, granted explicitly. There is
 * no `isAdmin` column on a user for somebody to flip by accident.
 */
export const PLATFORM_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE',
  'SUPPORT',
  'DEVELOPER',
  'ANALYST',
  'READ_ONLY',
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  // Reading customer records
  'admin.users.read',
  'admin.users.write',
  'admin.users.suspend',
  // Personal data is gated separately from the records that contain it: a role
  // can need to see that an account exists without needing its email address.
  'admin.users.pii',
  'admin.users.impersonate',

  'admin.subscriptions.read',
  'admin.subscriptions.write',

  'admin.billing.read',
  'admin.billing.refund',

  'admin.plans.read',
  'admin.plans.write',

  'admin.metrics.read',

  'admin.logs.read',
  'admin.audit.read',

  'admin.support.read',
  'admin.support.write',

  'admin.settings.read',
  'admin.settings.write',
  'admin.features.manage',

  'admin.infra.read',
  'admin.jobs.manage',

  // Administering the administrators. Only ever SUPER_ADMIN.
  'admin.admins.manage',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const READ_ONLY: PlatformPermission[] = [
  'admin.users.read',
  'admin.subscriptions.read',
  'admin.billing.read',
  'admin.plans.read',
  'admin.metrics.read',
];

const ANALYST: PlatformPermission[] = [...READ_ONLY];

const SUPPORT: PlatformPermission[] = [
  ...READ_ONLY,
  // Support needs the person's address to answer them at all.
  'admin.users.pii',
  'admin.users.write',
  'admin.support.read',
  'admin.support.write',
  'admin.audit.read',
];

const FINANCE: PlatformPermission[] = [
  ...READ_ONLY,
  'admin.users.pii',
  'admin.subscriptions.write',
  'admin.billing.refund',
  'admin.plans.write',
  'admin.audit.read',
];

const DEVELOPER: PlatformPermission[] = [
  ...READ_ONLY,
  'admin.logs.read',
  'admin.audit.read',
  'admin.infra.read',
  'admin.jobs.manage',
  'admin.features.manage',
];

const ADMIN: PlatformPermission[] = [
  ...new Set([
    ...SUPPORT,
    ...FINANCE,
    ...DEVELOPER,
    'admin.users.suspend' as const,
    'admin.settings.read' as const,
    'admin.settings.write' as const,
  ]),
];

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<PlatformPermission>> = {
  // Everything, including administering other administrators.
  SUPER_ADMIN: new Set(PLATFORM_PERMISSIONS),
  ADMIN: new Set(ADMIN),
  FINANCE: new Set(FINANCE),
  SUPPORT: new Set(SUPPORT),
  DEVELOPER: new Set(DEVELOPER),
  ANALYST: new Set(ANALYST),
  READ_ONLY: new Set(READ_ONLY),
};

export function platformRoleHas(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role].has(permission);
}

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, LocalizedMessage> = {
  SUPER_ADMIN: { 'pt-BR': 'Administrador geral', en: 'Super admin' },
  ADMIN: { 'pt-BR': 'Administrador', en: 'Admin' },
  FINANCE: { 'pt-BR': 'Financeiro', en: 'Finance' },
  SUPPORT: { 'pt-BR': 'Suporte', en: 'Support' },
  DEVELOPER: { 'pt-BR': 'Desenvolvimento', en: 'Developer' },
  ANALYST: { 'pt-BR': 'Análise', en: 'Analyst' },
  READ_ONLY: { 'pt-BR': 'Somente leitura', en: 'Read only' },
};

/**
 * Actions that change money, access or someone's account, and must record why.
 *
 * "Who did this and when" is not enough for these: six months later the only
 * question that matters is whether there was a reason, and an audit trail that
 * cannot answer it protects nobody.
 */
export const REASON_REQUIRED: ReadonlySet<PlatformPermission> = new Set([
  'admin.users.suspend',
  'admin.users.impersonate',
  'admin.billing.refund',
  'admin.subscriptions.write',
  'admin.settings.write',
  // Handing somebody access to every account on the platform is the most
  // consequential thing anybody does here, and it was the one action this list
  // originally left out.
  'admin.admins.manage',
]);
