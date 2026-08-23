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
import { monthlyCents, uuidv7 } from '@dmflow/shared';

let app: NestExpressApplication;
let server: Server;
let prisma: PrismaService;

const suffix = Date.now().toString(36);
const password = 'senhaforte123';

const boss = { email: `chefe-${suffix}@test.local`, password, name: 'Chefe Geral' };
const support = { email: `suporte-${suffix}@test.local`, password, name: 'Pessoa do Suporte' };
const analyst = { email: `analista-${suffix}@test.local`, password, name: 'Pessoa da Analise' };
const customer = { email: `cliente-${suffix}@test.local`, password, name: 'Cliente Comum' };

const cookies: Record<string, string> = {};
const userIds: Record<string, string> = {};
const workspaceIds: Record<string, string> = {};
const planIds: string[] = [];

const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

async function signUp(who: { email: string; password: string; name: string }, key: string) {
  const response = await request(server)
    .post('/auth/register')
    .set('X-Forwarded-For', freshAddress())
    .send(who)
    .expect(201);

  cookies[key] = (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  workspaceIds[key] = response.body.workspaceId;
  userIds[key] = response.body.userId;
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

  await signUp(boss, 'boss');
  await signUp(support, 'support');
  await signUp(analyst, 'analyst');
  await signUp(customer, 'customer');

  await prisma.platformAdmin.createMany({
    data: [
      { id: uuidv7(), userId: userIds.boss!, role: 'SUPER_ADMIN' },
      { id: uuidv7(), userId: userIds.support!, role: 'SUPPORT' },
      { id: uuidv7(), userId: userIds.analyst!, role: 'ANALYST' },
    ],
  });
}, 60_000);

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: Object.values(workspaceIds) } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@test.local` } } });
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
  await app.close();
});

describe('reading customer accounts', () => {
  it('lets support read the address and shows an analyst only that the account exists', async () => {
    const forSupport = await request(server)
      .get(`/admin/users?search=cliente-${suffix}`)
      .set('Cookie', cookies.support!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const seenBySupport = forSupport.body.users.find((u: { id: string }) => u.id === userIds.customer);
    expect(seenBySupport.email).toBe(customer.email);
    expect(seenBySupport.piiMasked).toBe(false);

    const forAnalyst = await request(server)
      .get(`/admin/users?search=cliente-${suffix}`)
      .set('Cookie', cookies.analyst!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const seenByAnalyst = forAnalyst.body.users.find((u: { id: string }) => u.id === userIds.customer);
    // Analysis needs to know an account exists; it does not need to know whose.
    expect(seenByAnalyst.piiMasked).toBe(true);
    expect(seenByAnalyst.email).not.toBe(customer.email);
    expect(seenByAnalyst.name).toBeNull();
    // Still recognisable enough to match against a support conversation.
    expect(seenByAnalyst.email).toContain('@test.local');
  });

  it('never returns a password hash or a second-factor secret', async () => {
    const list = await request(server)
      .get('/admin/users')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const detail = await request(server)
      .get(`/admin/users/${userIds.customer}`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    // An administrator must never be able to read a password, hashed or not.
    for (const body of [list.body, detail.body]) {
      const serialised = JSON.stringify(body);
      expect(serialised).not.toContain('passwordHash');
      expect(serialised).not.toContain('totpSecret');
      expect(serialised).not.toContain('$argon2');
    }

    // The fact that a second factor is on is a different thing from its secret.
    expect(detail.body.twoFactorEnabled).toBe(false);
  });

  it('shows what the account is worth using the same rule as the overview', async () => {
    const detail = await request(server)
      .get(`/admin/users/${userIds.customer}`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const workspace = detail.body.workspaces[0];
    expect(workspace.subscription.plan).toBe('free');
    expect(workspace.subscription.monthlyCents).toBe(monthlyCents(0, 'month'));
    expect(workspace.usage).toHaveProperty('contacts');
  });

  it('pages without repeating a record', async () => {
    const first = await request(server)
      .get('/admin/users?limit=2')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    expect(first.body.users).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(server)
      .get(`/admin/users?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const firstIds = first.body.users.map((u: { id: string }) => u.id);
    const secondIds = second.body.users.map((u: { id: string }) => u.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
  });

  it('says nothing exists rather than erroring on an unknown id', async () => {
    await request(server)
      .get(`/admin/users/${uuidv7()}`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(404);
  });
});

describe('blocking an account', () => {
  it('refuses to block without saying why', async () => {
    const response = await request(server)
      .post(`/admin/users/${userIds.customer}/suspend`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({});

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body.error.details)).toContain('reason');
  });

  it('ends the sessions in the same breath, and takes effect immediately', async () => {
    // The customer is signed in right now.
    await request(server)
      .get('/auth/me')
      .set('Cookie', cookies.customer!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const suspended = await request(server)
      .post(`/admin/users/${userIds.customer}/suspend`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'Uso da conta em desacordo com os termos, chamado 4821' })
      .expect(201);

    expect(suspended.body.sessionsRevoked).toBeGreaterThan(0);

    // Not when the cookie eventually expires — now.
    const afterwards = await request(server)
      .get('/auth/me')
      .set('Cookie', cookies.customer!)
      .set('X-Forwarded-For', freshAddress());
    expect([401, 403]).toContain(afterwards.status);

    // And signing in again does not get around it.
    const login = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', freshAddress())
      .send({ email: customer.email, password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('tells the person their data is safe without quoting the internal note', async () => {
    const login = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', freshAddress())
      .send({ email: customer.email, password });

    const message = JSON.stringify(login.body);
    expect(message).toMatch(/dados continuam salvos/i);
    // The reason was written for an audit trail, not to be read back to them.
    expect(message).not.toContain('chamado 4821');
  });

  it('records who blocked it, when and why', async () => {
    const trail = await request(server)
      .get('/admin/audit')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const entry = trail.body.find(
      (line: { action: string; entityId: string }) =>
        line.action === 'user.suspended' && line.entityId === userIds.customer,
    );
    expect(entry).toBeDefined();
    expect(entry.reason).toContain('4821');
    expect(entry.actor.email).toBe(boss.email);
  });

  it('lets the account back in when it is reactivated', async () => {
    await request(server)
      .post(`/admin/users/${userIds.customer}/reactivate`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'Situação resolvida com o cliente, chamado 4821' })
      .expect(201);

    const login = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', freshAddress())
      .send({ email: customer.email, password });

    expect(login.status).toBe(201);
    cookies.customer = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  });

  it('will not block an administrator through the customer screen', async () => {
    // Otherwise this is a way around every protection on administering admins.
    const response = await request(server)
      .post(`/admin/users/${userIds.support}/suspend`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'tentando bloquear um administrador pela tela de clientes' });

    expect(response.status).toBe(403);
  });

  it('refuses an admin whose role does not carry the power to block', async () => {
    const response = await request(server)
      .post(`/admin/users/${userIds.customer}/suspend`)
      .set('Cookie', cookies.analyst!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'analise nao deveria conseguir bloquear ninguem' });

    expect(response.status).toBe(403);
  });
});

describe('subscriptions', () => {
  it('lists what each account pays, normalised the same way as the total', async () => {
    const response = await request(server)
      .get('/admin/subscriptions?limit=5')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    expect(Array.isArray(response.body.subscriptions)).toBe(true);
    for (const row of response.body.subscriptions) {
      expect(typeof row.monthlyCents).toBe('number');
      expect(row.currency).toBeTruthy();
      // Whether billing is wired up, without exposing the provider's identifiers.
      expect(row).toHaveProperty('billingLinked');
      expect(JSON.stringify(row)).not.toContain('stripeCustomerId');
    }
  });

  it('hides the owner from a role without permission for personal data', async () => {
    const response = await request(server)
      .get('/admin/subscriptions?limit=5')
      .set('Cookie', cookies.analyst!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    for (const row of response.body.subscriptions) {
      if (row.owner) expect(row.owner.email).toBeNull();
    }
  });

  it('refuses a plan change with no reason, and records one that has it', async () => {
    const plan = await prisma.plan.create({
      data: {
        id: uuidv7(),
        code: `negociado-${suffix}`,
        name: 'Negociado',
        priceCents: 19_900,
        currency: 'BRL',
        interval: 'month',
        limits: {},
        isPublic: false,
      },
    });
    planIds.push(plan.id);

    const noReason = await request(server)
      .post(`/admin/subscriptions/${workspaceIds.customer}/plan`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ planCode: plan.code });
    expect(noReason.status).toBe(422);

    const changed = await request(server)
      .post(`/admin/subscriptions/${workspaceIds.customer}/plan`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ planCode: plan.code, reason: 'Preço negociado no contrato anual, chamado 5120' })
      .expect(201);

    expect(changed.body.monthlyCents).toBe(19_900);
    // The platform's grant moved; the provider's charge did not, and it says so
    // rather than letting somebody assume otherwise.
    expect(changed.body.notice['pt-BR']).toMatch(/Stripe/);
  });

  it('makes the change show up in recurring revenue', async () => {
    const response = await request(server)
      .get('/admin/metrics/revenue')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    // The account moved from free to a paid plan a moment ago, through the admin
    // screen — and the metrics layer counts it like any other paying account.
    expect(response.body.mrr.BRL).toBeGreaterThanOrEqual(19_900);
  });

  it('refuses a plan that does not exist', async () => {
    const response = await request(server)
      .post(`/admin/subscriptions/${workspaceIds.customer}/plan`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ planCode: 'plano-inventado', reason: 'testando um plano que nao existe' });

    expect(response.status).toBe(422);
  });

  it('refuses a role that may read subscriptions but not change them', async () => {
    await request(server)
      .get('/admin/subscriptions')
      .set('Cookie', cookies.support!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const response = await request(server)
      .post(`/admin/subscriptions/${workspaceIds.customer}/plan`)
      .set('Cookie', cookies.support!)
      .set('X-Forwarded-For', freshAddress())
      .send({ planCode: 'free', reason: 'suporte nao deveria mudar plano de ninguem' });

    expect(response.status).toBe(403);
  });
});

describe('the first screen', () => {
  it('answers with revenue, what moved, and how each figure is defined', async () => {
    const response = await request(server)
      .get('/admin/overview')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    expect(response.body.revenue).toHaveProperty('mrr');
    expect(response.body.growth).toHaveProperty('signups');
    // Shipped with the numbers so no screen has to write its own wording for
    // what MRR means.
    expect(response.body.definitions.length).toBeGreaterThan(5);
  });

  it('is closed to somebody who is not an administrator at all', async () => {
    await request(server)
      .get('/admin/overview')
      .set('Cookie', cookies.customer!)
      .set('X-Forwarded-For', freshAddress())
      .expect(404);
  });
});
