import { describe, expect, it } from 'vitest';
import {
  MEMBER_ROLES,
  PERMISSIONS,
  isPermittedWhileSuspended,
  roleHasPermission,
} from '../rbac';

describe('role permissions', () => {
  it('gives OWNER everything', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('withholds workspace deletion and ownership transfer from ADMIN', () => {
    expect(roleHasPermission('ADMIN', 'workspace:delete')).toBe(false);
    expect(roleHasPermission('ADMIN', 'workspace:transfer_ownership')).toBe(false);
    expect(roleHasPermission('ADMIN', 'billing:manage')).toBe(true);
  });

  it('keeps EDITOR out of billing and member management', () => {
    expect(roleHasPermission('EDITOR', 'automation:publish')).toBe(true);
    expect(roleHasPermission('EDITOR', 'billing:manage')).toBe(false);
    expect(roleHasPermission('EDITOR', 'member:invite')).toBe(false);
  });

  it('confines AGENT to the inbox', () => {
    expect(roleHasPermission('AGENT', 'inbox:send')).toBe(true);
    expect(roleHasPermission('AGENT', 'automation:publish')).toBe(false);
    expect(roleHasPermission('AGENT', 'contact:delete')).toBe(false);
    expect(roleHasPermission('AGENT', 'analytics:read')).toBe(false);
  });

  it('makes VIEWER strictly read-only', () => {
    const writes = PERMISSIONS.filter(
      (p) =>
        p.includes(':create') ||
        p.includes(':update') ||
        p.includes(':delete') ||
        p.includes(':manage') ||
        p.includes(':send') ||
        p.includes(':publish'),
    );
    for (const permission of writes) {
      expect(roleHasPermission('VIEWER', permission)).toBe(false);
    }
  });

  it('every role is defined', () => {
    for (const role of MEMBER_ROLES) {
      expect(roleHasPermission(role, 'workspace:read')).toBe(true);
    }
  });
});

describe('suspended workspace', () => {
  it('keeps reading and paying open', () => {
    for (const permission of ['contact:read', 'analytics:read', 'billing:manage', 'contact:export'] as const) {
      expect(isPermittedWhileSuspended(permission)).toBe(true);
    }
  });

  it('blocks anything that changes data or sends messages', () => {
    for (const permission of ['inbox:send', 'contact:create', 'automation:publish', 'channel:connect'] as const) {
      expect(isPermittedWhileSuspended(permission)).toBe(false);
    }
  });
});
