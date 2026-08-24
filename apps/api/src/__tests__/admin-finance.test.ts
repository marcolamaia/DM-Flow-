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
import { StripeClient } from '../billing/stripe.client';
import { loadEnv } from '../config/env';
import { dayKey, uuidv7 } from '@dmflow/shared';

let app: NestExpressApplication;
let server: Server;
let prisma: PrismaService;
let stripeConfigured = false;

const suffix = Date.now().toString(36);
const password = 'senhaforte123';

const boss = { email: `financeiro-${suffix}@test.local`, password, name: 'Chefe' };
const dev = { email: `dev-${suffix}@test.local`, password, name: 'Pessoa de Dev' };

const cookies: Record<string, string> = {};
const userIds: Record<string, string> = {};
const workspaceIds: Record<string, string> = {};
const planIds: string[] = [];
const eventIds: string[] = [];
const stripeEventIds: string[] = [];

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
  stripeConfigured = app.get(StripeClient).configured;

  await signUp(boss, 'boss');
  await signUp(dev, 'dev');

  await prisma.platformAdmin.createMany({
    data: [
      { id: uuidv7(), userId: userIds.boss!, role: 'SUPER_ADMIN' },
      { id: uuidv7(), userId: userIds.dev!, role: 'DEVELOPER' },
    ],
  });
}, 60_000);

afterAll(async () => {
  await prisma.domainEvent.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.stripeEvent.deleteMany({ where: { id: { in: stripeEventIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: Object.values(workspaceIds) } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@test.local` } } });
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
  await app.close();
});

const asBoss = (path: string) =>
  request(server).get(path).set('Cookie', cookies.boss!).set('X-Forwarded-For', freshAddress());

describe('recurring revenue, split by plan', () => {
  it('adds up to exactly what the overview reports', async () => {
    const [byPlan, revenue] = await Promise.all([
      asBoss('/admin/finance/by-plan').expect(200),
      asBoss('/admin/metrics/revenue').expect(200),
    ]);

    // The whole point of the metrics layer: a breakdown that does not add up to
    // the headline means one of the two is computing its own version.
    const totals: Record<string, number> = {};
    for (const row of byPlan.body as Array<{ currency: string; mrrCents: number }>) {
      totals[row.currency] = (totals[row.currency] ?? 0) + row.mrrCents;
    }

    expect(totals).toEqual(revenue.body.mrr);
  });

  it('counts at-risk accounts without letting them into the total', async () => {
    const plan = await prisma.plan.create({
      data: {
        id: uuidv7(),
        code: `risco-${suffix}`,
        name: 'Em risco',
        priceCents: 5000,
        currency: 'BRL',
        interval: 'month',
        limits: {},
        isPublic: false,
      },
    });
    planIds.push(plan.id);

    await prisma.subscription.update({
      where: { workspaceId: workspaceIds.dev! },
      data: { planId: plan.id, status: 'PAST_DUE', pastDueSince: new Date() },
    });

    const byPlan = await asBoss('/admin/finance/by-plan').expect(200);
    const row = (byPlan.body as Array<{ code: string; atRiskCount: number; mrrCents: number }>).find(
      (entry) => entry.code === plan.code,
    );

    expect(row).toBeDefined();
    expect(row!.atRiskCount).toBe(1);
    // At-risk revenue is not revenue.
    expect(row!.mrrCents).toBe(0);
  });
});

describe('cash movements', () => {
  it('subtracts refunds from what came in, and never counts a failed charge', async () => {
    const workspaceId = workspaceIds.boss!;
    const now = new Date();

    const created = await prisma.domainEvent.createManyAndReturn({
      data: [
        {
          id: uuidv7(),
          event: 'payment.succeeded',
          workspaceId,
          amountCents: 20_000,
          currency: 'BRL',
          occurredAt: now,
        },
        {
          id: uuidv7(),
          event: 'refund.issued',
          workspaceId,
          amountCents: 5_000,
          currency: 'BRL',
          occurredAt: now,
        },
        {
          id: uuidv7(),
          event: 'payment.failed',
          workspaceId,
          amountCents: 99_999,
          currency: 'BRL',
          occurredAt: now,
        },
      ],
    });
    eventIds.push(...created.map((row) => row.id));

    // No fuso do relatório, não em UTC: entre 21h e a meia-noite de São Paulo
    // o "hoje" de UTC já é o dia seguinte, onde nada aconteceu ainda.
    const today = dayKey(new Date());
    const cashflow = await asBoss(
      `/admin/finance/cashflow?from=${today}&to=${today}`,
    ).expect(200);

    expect(cashflow.body.received.BRL).toBeGreaterThanOrEqual(20_000);
    expect(cashflow.body.refunded.BRL).toBeGreaterThanOrEqual(5_000);
    // Net is what came in less what left again.
    expect(cashflow.body.net.BRL).toBe(
      cashflow.body.received.BRL - cashflow.body.refunded.BRL - (cashflow.body.chargedBack.BRL ?? 0),
    );
    // A charge that failed is money the platform did not get. It is reported,
    // and it is not revenue.
    expect(cashflow.body.failed.BRL).toBeGreaterThanOrEqual(99_999);
    expect(cashflow.body.received.BRL).toBeLessThan(99_999);
  });

  it('returns a day for every day in the window', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    const cashflow = await asBoss(
      `/admin/finance/cashflow?from=${dayKey(from)}&to=${dayKey(to)}`,
    ).expect(200);

    expect(cashflow.body.series.length).toBeGreaterThanOrEqual(7);
  });
});

describe('accounts the platform is failing to collect from', () => {
  it('says how long is left before the workspace is suspended', async () => {
    const problems = await asBoss('/admin/finance/collection-problems').expect(200);

    const row = (problems.body as Array<{ workspaceId: string; graceDaysRemaining: number | null }>).find(
      (entry) => entry.workspaceId === workspaceIds.dev,
    );

    expect(row).toBeDefined();
    // The number an operator actually acts on.
    expect(typeof row!.graceDaysRemaining).toBe('number');
  });
});

describe('webhook health', () => {
  it('reports what arrived and what was processed', async () => {
    const health = await asBoss('/admin/webhooks/health').expect(200);

    expect(health.body).toHaveProperty('total');
    expect(health.body).toHaveProperty('pending');
    expect(health.body).toHaveProperty('stuck');
    expect(health.body.configured).toBe(stripeConfigured);
  });

  it('never hands back the provider payload', async () => {
    const record = await prisma.stripeEvent.create({
      data: {
        id: `evt_test_${suffix}`,
        type: 'invoice.payment_succeeded',
        // A real payload carries names, addresses and card metadata.
        payload: { customer_name: 'Nome Que Nao Deve Vazar', object: 'event' } as never,
      },
    });
    stripeEventIds.push(record.id);

    const list = await asBoss('/admin/webhooks?limit=50').expect(200);

    expect(JSON.stringify(list.body)).not.toContain('Nome Que Nao Deve Vazar');
    expect(JSON.stringify(list.body)).not.toContain('payload');
    // The things the screen actually needs are there.
    const row = (list.body as Array<{ id: string; type: string }>).find(
      (entry) => entry.id === record.id,
    );
    expect(row?.type).toBe('invoice.payment_succeeded');
  });

  it('refuses to reprocess without a reason', async () => {
    const response = await request(server)
      .post(`/admin/webhooks/evt_test_${suffix}/reprocess`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({});

    expect(response.status).toBe(422);
  });

  it('reports a reprocess that failed instead of throwing an error page', async () => {
    const response = await request(server)
      .post(`/admin/webhooks/evt_test_${suffix}/reprocess`)
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'testando o reprocessamento de um evento guardado' })
      .expect(201);

    // The operator asked whether it works now. Either answer is a result.
    expect(response.body.reprocessed).toBe(true);
    expect(typeof response.body.succeeded).toBe('boolean');
  });

  it('says nothing exists for an unknown event', async () => {
    await request(server)
      .post('/admin/webhooks/evt_nao_existe/reprocess')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'evento que nao existe neste banco' })
      .expect(404);
  });
});

describe('reconciliation', () => {
  it('never reports agreement it did not check', async () => {
    const report = await asBoss('/admin/reconciliation').expect(200);

    expect(report.body.localChecked).toBe(true);
    expect(typeof report.body.stripeChecked).toBe('boolean');

    if (!report.body.stripeChecked) {
      // "No discrepancies" and "never looked" must never render the same. When
      // the provider half is skipped, the report says so in words.
      expect(report.body.stripeSkippedReason).toBeTruthy();
      expect(report.body.stripeSkippedReason).toMatch(/Stripe/);
    } else {
      expect(report.body.stripeSkippedReason).toBeNull();
    }
  });

  it('finds an account counted as revenue with nothing behind it at the provider', async () => {
    const plan = await prisma.plan.create({
      data: {
        id: uuidv7(),
        code: `orfao-${suffix}`,
        name: 'Órfão',
        priceCents: 12_900,
        currency: 'BRL',
        interval: 'month',
        limits: {},
        isPublic: false,
        stripePriceId: 'price_teste',
      },
    });
    planIds.push(plan.id);

    await prisma.subscription.update({
      where: { workspaceId: workspaceIds.boss! },
      data: { planId: plan.id, status: 'ACTIVE', stripeSubscriptionId: null },
    });

    const report = await asBoss('/admin/reconciliation').expect(200);
    const finding = (report.body.findings as Array<{ code: string; workspaceId: string | null }>).find(
      (entry) => entry.code === 'PAID_WITHOUT_PROVIDER' && entry.workspaceId === workspaceIds.boss,
    );

    expect(finding).toBeDefined();
  });

  it('finds an account that is late with no date to count the grace period from', async () => {
    await prisma.subscription.update({
      where: { workspaceId: workspaceIds.dev! },
      data: { status: 'PAST_DUE', pastDueSince: null },
    });

    const report = await asBoss('/admin/reconciliation').expect(200);
    const finding = (report.body.findings as Array<{ code: string; workspaceId: string | null }>).find(
      (entry) => entry.code === 'PAST_DUE_WITHOUT_DATE' && entry.workspaceId === workspaceIds.dev,
    );

    // Without the date, the job that suspends overdue workspaces never sees it.
    expect(finding).toBeDefined();
  });

  it('suggests what to do rather than repairing anything by itself', async () => {
    const report = await asBoss('/admin/reconciliation').expect(200);

    for (const finding of report.body.findings as Array<{ suggestion: string; detail: string }>) {
      expect(finding.suggestion.length).toBeGreaterThan(20);
      expect(finding.detail.length).toBeGreaterThan(20);
    }
  });
});

describe('refunds', () => {
  it('refuses a refund with no reason', async () => {
    const response = await request(server)
      .post('/admin/finance/refund')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ paymentIntentId: 'pi_qualquer' });

    expect(response.status).toBe(422);
  });

  it('refuses to record a refund that no money would follow', async () => {
    if (stripeConfigured) return;

    const before = await prisma.domainEvent.count({ where: { event: 'refund.issued' } });

    const response = await request(server)
      .post('/admin/finance/refund')
      .set('Cookie', cookies.boss!)
      .set('X-Forwarded-For', freshAddress())
      .send({ paymentIntentId: 'pi_qualquer', reason: 'cliente pediu reembolso, chamado 7712' });

    // Billing is not configured here, so there is no refund to make. Recording
    // one anyway would put a false movement into the revenue figures.
    // 503, not 400: nothing about the request is wrong — the installation simply
    // has no billing configured, which is a state of the server.
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('BILLING_NOT_CONFIGURED');

    const after = await prisma.domainEvent.count({ where: { event: 'refund.issued' } });
    expect(after).toBe(before);
  });

  it('is closed to a role that administers infrastructure but not money', async () => {
    const response = await request(server)
      .post('/admin/finance/refund')
      .set('Cookie', cookies.dev!)
      .set('X-Forwarded-For', freshAddress())
      .send({ paymentIntentId: 'pi_qualquer', reason: 'desenvolvimento nao deveria reembolsar' });

    expect(response.status).toBe(403);
  });

  it('lets that same role reprocess a webhook, which is its job', async () => {
    const response = await request(server)
      .post(`/admin/webhooks/evt_test_${suffix}/reprocess`)
      .set('Cookie', cookies.dev!)
      .set('X-Forwarded-For', freshAddress())
      .send({ reason: 'desenvolvimento reprocessando um evento travado' });

    expect(response.status).toBe(201);
  });
});
