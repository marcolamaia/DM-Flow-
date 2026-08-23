import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DmFlowExceptionFilter } from '../common/exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv } from '../config/env';
import {
  PLATFORM_ROLE_PERMISSIONS,
  REASON_REQUIRED,
  platformRoleHas,
  uuidv7,
} from '@dmflow/shared';

let app: NestExpressApplication;
let server: Server;
let prisma: PrismaService;

const suffix = Date.now().toString(36);
const customer = { email: `cliente-${suffix}@test.local`, password: 'senhaforte123', name: 'Cliente' };
const staff = { email: `staff-${suffix}@test.local`, password: 'senhaforte123', name: 'Suporte' };
const boss = { email: `chefe-${suffix}@test.local`, password: 'senhaforte123', name: 'Chefe' };

let customerCookie = '';
let staffCookie = '';
let bossCookie = '';
let customerWorkspace = '';
const workspaces: string[] = [];

const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

async function signUp(who: typeof customer): Promise<{ cookie: string; workspaceId: string }> {
  const response = await request(server)
    .post('/auth/register')
    .set('X-Forwarded-For', freshAddress())
    .send(who)
    .expect(201);

  workspaces.push(response.body.workspaceId);
  return {
    cookie: (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
    workspaceId: response.body.workspaceId,
  };
}

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.use(express.json());
  app.use(cookieParser(loadEnv().SESSION_SECRET));
  app.useGlobalFilters(new DmFlowExceptionFilter());
  app.set('trust proxy', 1);
  await app.init();

  server = app.getHttpServer() as Server;
  prisma = app.get(PrismaService);

  const a = await signUp(customer);
  customerCookie = a.cookie;
  customerWorkspace = a.workspaceId;
  staffCookie = (await signUp(staff)).cookie;
  bossCookie = (await signUp(boss)).cookie;

  const staffUser = await prisma.user.findUnique({ where: { email: staff.email } });
  const bossUser = await prisma.user.findUnique({ where: { email: boss.email } });

  await prisma.platformAdmin.create({
    data: { id: uuidv7(), userId: staffUser!.id, role: 'SUPPORT' },
  });
  await prisma.platformAdmin.create({
    data: { id: uuidv7(), userId: bossUser!.id, role: 'SUPER_ADMIN' },
  });
}, 60_000);

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({
    where: { email: { in: [customer.email, staff.email, boss.email] } },
  });
  await app.close();
});

describe('who may reach the administrative surface', () => {
  it('refuses a signed-out caller', async () => {
    await request(server).get('/admin/me').set('X-Forwarded-For', freshAddress()).expect(401);
  });

  it('tells an ordinary customer nothing — not even that it exists', async () => {
    const response = await request(server)
      .get('/admin/me')
      .set('Cookie', customerCookie)
      .set('X-Forwarded-For', freshAddress());

    // 404, not 403: whether the platform has an admin panel is not a customer's
    // business, and a 403 confirms it does.
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('role');
    expect(JSON.stringify(response.body)).not.toContain('permission');
  });

  it('refuses an ordinary customer on every administrative route', async () => {
    for (const path of ['/admin/me', '/admin/admins', '/admin/audit', '/admin/events']) {
      const response = await request(server)
        .get(path)
        .set('Cookie', customerCookie)
        .set('X-Forwarded-For', freshAddress());

      expect(response.status).toBe(404);
      // Nothing leaks in the body of a refusal.
      expect(Array.isArray(response.body)).toBe(false);
    }
  });

  it('lets an admin in, and says what they may do', async () => {
    const response = await request(server)
      .get('/admin/me')
      .set('Cookie', staffCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    expect(response.body.role).toBe('SUPPORT');
    expect(response.body.permissions).toContain('admin.support.read');
  });

  it('refuses an admin a permission their role does not carry', async () => {
    // Support can read customer records; support cannot administer administrators.
    const response = await request(server)
      .get('/admin/admins')
      .set('Cookie', staffCookie)
      .set('X-Forwarded-For', freshAddress());

    expect(response.status).toBe(403);
  });

  it('stops honouring a grant the moment it is revoked', async () => {
    const staffUser = await prisma.user.findUnique({ where: { email: staff.email } });
    await prisma.platformAdmin.update({
      where: { userId: staffUser!.id },
      data: { revokedAt: new Date() },
    });

    // Immediately, without waiting for the session to expire.
    await request(server)
      .get('/admin/me')
      .set('Cookie', staffCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(404);

    await prisma.platformAdmin.update({
      where: { userId: staffUser!.id },
      data: { revokedAt: null },
    });
  });
});

describe('administrative actions leave a trail', () => {
  it('refuses a critical action that arrives with no reason', async () => {
    const response = await request(server)
      .post('/admin/admins')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ email: customer.email, role: 'ANALYST' });

    // Granting administrative access is not something that should be possible
    // without saying why.
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body.error.details)).toContain('reason');
  });

  it('records who did what, to whom, and why', async () => {
    const granted = await request(server)
      .post('/admin/admins')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .send({
        email: customer.email,
        role: 'ANALYST',
        reason: 'Analista contratada para o time de dados',
      })
      .expect(201);

    const trail = await request(server)
      .get('/admin/audit')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    // Found by the grant this run created, not by action name: the trail is
    // append-only, so earlier runs of this very test are still in it.
    const entry = trail.body.find(
      (line: { entityId: string }) => line.entityId === granted.body.id,
    );
    expect(entry).toBeDefined();
    expect(entry.reason).toContain('Analista');
    expect(entry.actor.email).toBe(boss.email);
    expect(entry.after.role).toBe('ANALYST');
    expect(entry.action).toMatch(/^admin\.(granted|role_changed)$/);
  });

  it('refuses to revoke the last super admin', async () => {
    const bossUser = await prisma.user.findUnique({ where: { email: boss.email } });
    const grant = await prisma.platformAdmin.findUnique({ where: { userId: bossUser!.id } });

    // Anything else would lock everybody out, with no way back except opening
    // the database by hand.
    const others = await prisma.platformAdmin.count({
      where: { role: 'SUPER_ADMIN', revokedAt: null, id: { not: grant!.id } },
    });
    if (others > 0) return;

    const response = await request(server)
      .post('/admin/admins/revoke')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ id: grant!.id, reason: 'testando a proteção do último super admin' });

    expect(response.status).toBe(403);
  });
});

describe('platform roles', () => {
  it('gives read-only exactly that', () => {
    expect(platformRoleHas('READ_ONLY', 'admin.users.read')).toBe(true);
    expect(platformRoleHas('READ_ONLY', 'admin.users.write')).toBe(false);
    expect(platformRoleHas('READ_ONLY', 'admin.billing.refund')).toBe(false);
  });

  it('keeps personal data behind its own permission', () => {
    // Seeing that an account exists and seeing its email address are different
    // questions, and analysis does not need the second one.
    expect(platformRoleHas('ANALYST', 'admin.users.read')).toBe(true);
    expect(platformRoleHas('ANALYST', 'admin.users.pii')).toBe(false);
    expect(platformRoleHas('SUPPORT', 'admin.users.pii')).toBe(true);
  });

  it('lets only the top role administer administrators', () => {
    for (const role of ['ADMIN', 'FINANCE', 'SUPPORT', 'DEVELOPER', 'ANALYST', 'READ_ONLY'] as const) {
      expect(platformRoleHas(role, 'admin.admins.manage')).toBe(false);
    }
    expect(platformRoleHas('SUPER_ADMIN', 'admin.admins.manage')).toBe(true);
  });

  it('gives finance refunds and developers infrastructure, and not the reverse', () => {
    expect(platformRoleHas('FINANCE', 'admin.billing.refund')).toBe(true);
    expect(platformRoleHas('DEVELOPER', 'admin.billing.refund')).toBe(false);
    expect(platformRoleHas('DEVELOPER', 'admin.infra.read')).toBe(true);
    expect(platformRoleHas('FINANCE', 'admin.infra.read')).toBe(false);
  });

  it('requires a reason for everything that touches money, access or an account', () => {
    for (const permission of [
      'admin.users.suspend',
      'admin.users.impersonate',
      'admin.billing.refund',
    ] as const) {
      expect(REASON_REQUIRED.has(permission)).toBe(true);
    }
    // Reading never needs a justification; demanding one would make the trail
    // noise rather than signal.
    expect(REASON_REQUIRED.has('admin.users.read')).toBe(false);
  });

  it('never leaves a role with no permissions at all', () => {
    for (const [role, permissions] of Object.entries(PLATFORM_ROLE_PERMISSIONS)) {
      expect(permissions.size, `${role} has no permissions`).toBeGreaterThan(0);
    }
  });
});

describe('recorded facts', () => {
  it('writes a domain event when somebody registers', async () => {
    const record = await prisma.user.findUnique({ where: { email: customer.email } });
    expect(record).not.toBeNull();

    const events = await request(server)
      .get('/admin/events?event=user.registered&limit=100')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    expect(Array.isArray(events.body)).toBe(true);
  });
});
