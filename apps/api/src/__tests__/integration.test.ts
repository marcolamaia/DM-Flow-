import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../app.module';
import { DmFlowExceptionFilter } from '../common/exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityService } from '../capabilities/capability.service';
import { loadEnv } from '../config/env';
import { CAP, PLAN_DEFINITIONS, uuidv7 } from '@dmflow/shared';

/**
 * Runs against a real Postgres and Redis rather than mocks. The behaviours these
 * cover — tenant isolation, idempotency, signature rejection — are precisely the
 * ones that a mock would happily lie about.
 */
let app: INestApplication;
let prisma: PrismaService;
let capabilities: CapabilityService;
let server: Server;

const RAW_BODY_PREFIXES = ['/webhooks/', '/billing/stripe/webhook'];

const suffix = Date.now().toString(36);
const userA = { email: `a-${suffix}@test.local`, password: 'senhaforte123', name: 'Tenant A' };
const userB = { email: `b-${suffix}@test.local`, password: 'senhaforte123', name: 'Tenant B' };

let cookieA = '';
let cookieB = '';
let workspaceA = '';
let workspaceB = '';

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const env = loadEnv();

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        const url = (req as express.Request).originalUrl ?? '';
        if (RAW_BODY_PREFIXES.some((p) => url.startsWith(p))) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(cookieParser(env.SESSION_SECRET));
  app.useGlobalFilters(new DmFlowExceptionFilter());

  await app.init();
  server = app.getHttpServer() as Server;

  prisma = app.get(PrismaService);
  capabilities = app.get(CapabilityService);

  // The free plan must exist for registration to succeed.
  for (const plan of PLAN_DEFINITIONS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: {
        id: uuidv7(),
        code: plan.code,
        name: plan.name,
        priceCents: plan.priceCents,
        currency: plan.currency,
        limits: plan.limits as never,
        features: plan.features,
        sortOrder: plan.sortOrder,
      },
      update: {},
    });
  }

  for (const [user, target] of [
    [userA, 'A'],
    [userB, 'B'],
  ] as const) {
    const response = await request(server).post('/auth/register').send(user).expect(201);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    if (target === 'A') {
      cookieA = cookie;
      workspaceA = response.body.workspaceId;
    } else {
      cookieB = cookie;
      workspaceB = response.body.workspaceId;
    }
  }
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } });
  await prisma.user.deleteMany({ where: { email: { in: [userA.email, userB.email] } } });
  await app.close();
});

describe('tenant isolation', () => {
  it('refuses a workspace the user does not belong to', async () => {
    const response = await request(server)
      .get('/workspaces/current')
      .set('Cookie', cookieB)
      .set('x-dmflow-workspace', workspaceA)
      .expect(403);
    expect(response.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('hides another tenant’s resource behind NOT_FOUND, not FORBIDDEN', async () => {
    // Confirming a resource exists elsewhere is itself a disclosure.
    const tag = await request(server)
      .post('/tags')
      .set('Cookie', cookieA)
      .set('x-dmflow-workspace', workspaceA)
      .send({ name: `iso-${suffix}` })
      .expect(201);

    const response = await request(server)
      .patch(`/tags/${tag.body.id}`)
      .set('Cookie', cookieB)
      .set('x-dmflow-workspace', workspaceB)
      .send({ name: 'stolen' })
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('never lists another tenant’s contacts', async () => {
    await request(server)
      .post('/contacts')
      .set('Cookie', cookieA)
      .set('x-dmflow-workspace', workspaceA)
      .send({ displayName: `Only A ${suffix}`, primaryChannel: 'INSTAGRAM' })
      .expect(201);

    const response = await request(server)
      .get('/contacts')
      .set('Cookie', cookieB)
      .set('x-dmflow-workspace', workspaceB)
      .expect(200);

    expect(response.body.data).toHaveLength(0);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(server)
      .get('/contacts')
      .set('x-dmflow-workspace', workspaceA)
      .expect(401);
    expect(response.body.error.code).toBe('NOT_AUTHENTICATED');
  });
});

describe('webhook signature', () => {
  const payload = { events: [{ providerEventId: `sig-${suffix}`, type: 'message_received' }] };

  it('rejects a delivery with no signature', async () => {
    await request(server).post('/webhooks/instagram').send(payload).expect(401);
  });

  it('rejects a forged signature', async () => {
    await request(server)
      .post('/webhooks/instagram')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(payload)
      .expect(401);
  });

  it('accepts a correctly signed delivery and stores it exactly once', async () => {
    const env = loadEnv();
    const secret = env.META_APP_SECRET || env.SESSION_SECRET;
    const body = {
      events: [
        {
          providerEventId: `dedupe-${suffix}`,
          type: 'message_received',
          externalAccountId: 'ig_sandbox_nonexistent',
          sender: { externalUserId: 'u1' },
          text: 'hello',
          externalMessageId: `m-${suffix}`,
        },
      ],
    };
    // Sent as an exact string: a Buffer would be re-serialised by the HTTP client
    // and the bytes the server verifies would no longer be the bytes we signed.
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;

    const send = () =>
      request(server)
        .post('/webhooks/instagram')
        .set('x-hub-signature-256', signature)
        .set('content-type', 'application/json')
        .send(raw)
        .expect(200);

    await send();
    // The same delivery again must not produce a second row.
    await send();

    const stored = await prisma.webhookEvent.count({
      where: { providerEventId: `dedupe-${suffix}` },
    });
    expect(stored).toBe(1);

    await prisma.webhookEvent.deleteMany({ where: { providerEventId: `dedupe-${suffix}` } });
  });
});

describe('capability engine', () => {
  it('denies an unvalidated live capability with no override available', async () => {
    const account = await prisma.connectedAccount.create({
      data: {
        id: uuidv7(),
        workspaceId: workspaceA,
        channel: 'INSTAGRAM',
        externalAccountId: `ig_live_${suffix}`,
        username: 'live_account',
        status: 'CONNECTED',
        isSandbox: false,
      },
    });

    const decision = await capabilities.decide({
      capabilityId: CAP.IG_SEND_TEXT,
      workspaceId: workspaceA,
      connectedAccountId: account.id,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('NOT_VALIDATED');
      // The denial explains itself in both locales.
      expect(decision.userMessage['pt-BR']).toBeTruthy();
      expect(decision.userMessage.en).toBeTruthy();
    }

    await prisma.connectedAccount.delete({ where: { id: account.id } });
  });

  it('spends a one-shot claim exactly once', async () => {
    const target = `cmt-${suffix}`;
    const first = await capabilities.claimOneShot(workspaceA, CAP.IG_SEND_PRIVATE_REPLY, target);
    const second = await capabilities.claimOneShot(workspaceA, CAP.IG_SEND_PRIVATE_REPLY, target);

    expect(first).toBe(true);
    // The second attempt loses, which is what stops a retry double-messaging.
    expect(second).toBe(false);

    await prisma.idempotencyRecord.deleteMany({ where: { workspaceId: workspaceA, key: target } });
  });

  it('denies sending to an unsubscribed contact whatever the flow says', async () => {
    const contact = await prisma.contact.create({
      data: {
        id: uuidv7(),
        workspaceId: workspaceA,
        primaryChannel: 'INSTAGRAM',
        status: 'UNSUBSCRIBED',
      },
    });

    const decision = await capabilities.decide({
      capabilityId: CAP.IG_SEND_TEXT,
      workspaceId: workspaceA,
      contactId: contact.id,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('CONTACT_UNSUBSCRIBED');

    await prisma.contact.delete({ where: { id: contact.id } });
  });

  it('denies everything while the workspace is suspended', async () => {
    await prisma.workspace.update({
      where: { id: workspaceA },
      data: { status: 'SUSPENDED', suspensionReason: 'test' },
    });

    const decision = await capabilities.decide({
      capabilityId: CAP.IG_SEND_TEXT,
      workspaceId: workspaceA,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('WORKSPACE_SUSPENDED');

    await prisma.workspace.update({
      where: { id: workspaceA },
      data: { status: 'ACTIVE', suspensionReason: null },
    });
  });
});

describe('plan quotas', () => {
  it('refuses to exceed the free plan contact limit and says why', async () => {
    const free = await prisma.plan.findUnique({ where: { code: 'free' } });
    await prisma.subscription.update({
      where: { workspaceId: workspaceB },
      data: { planId: free!.id },
    });

    // Free allows one connected account; the second attempt must be refused.
    await prisma.connectedAccount.create({
      data: {
        id: uuidv7(),
        workspaceId: workspaceB,
        channel: 'INSTAGRAM',
        externalAccountId: `ig_quota_${suffix}`,
        username: 'quota_account',
        status: 'CONNECTED',
        isSandbox: true,
      },
    });

    const response = await request(server)
      .post('/channels/connect')
      .set('Cookie', cookieB)
      .set('x-dmflow-workspace', workspaceB)
      .send({ channel: 'INSTAGRAM' })
      .expect(402);

    expect(response.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(response.body.error.context.metric).toBe('connectedAccounts');
    expect(response.body.error.remediation.action).toBe('upgrade_plan');
  });
});

describe('RBAC', () => {
  it('denies an action the role does not carry, naming the permission', async () => {
    await prisma.workspaceMember.updateMany({
      where: { workspaceId: workspaceA },
      data: { role: 'AGENT' },
    });

    const response = await request(server)
      .post('/automations')
      .set('Cookie', cookieA)
      .set('x-dmflow-workspace', workspaceA)
      .send({ name: 'should not be allowed' })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.context.permission).toBe('automation:create');

    await prisma.workspaceMember.updateMany({
      where: { workspaceId: workspaceA },
      data: { role: 'OWNER' },
    });
  });
});
