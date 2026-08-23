import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DmFlowExceptionFilter } from '../common/exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv } from '../config/env';
import { uuidv7 } from '@dmflow/shared';

let app: NestExpressApplication;
let server: Server;
let prisma: PrismaService;

const suffix = Date.now().toString(36);
const boss = { email: `metricas-${suffix}@test.local`, password: 'senhaforte123', name: 'Chefe' };

let bossCookie = '';
const workspaces: string[] = [];
const planIds: string[] = [];
const eventIds: string[] = [];

const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

async function signUp(name: string): Promise<string> {
  const response = await request(server)
    .post('/auth/register')
    .set('X-Forwarded-For', freshAddress())
    .send({ email: `${name}-${suffix}@test.local`, password: 'senhaforte123', name })
    .expect(201);

  workspaces.push(response.body.workspaceId);
  return response.body.workspaceId;
}

async function makePlan(code: string, priceCents: number, currency: string, interval: string) {
  const plan = await prisma.plan.create({
    data: {
      id: uuidv7(),
      code: `${code}-${suffix}`,
      name: code,
      priceCents,
      currency,
      interval,
      limits: {},
      isPublic: false,
    },
  });
  planIds.push(plan.id);
  return plan.id;
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

  const registration = await request(server)
    .post('/auth/register')
    .set('X-Forwarded-For', freshAddress())
    .send(boss)
    .expect(201);
  workspaces.push(registration.body.workspaceId);
  bossCookie = (registration.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

  const bossUser = await prisma.user.findUnique({ where: { email: boss.email } });
  await prisma.platformAdmin.create({
    data: { id: uuidv7(), userId: bossUser!.id, role: 'SUPER_ADMIN' },
  });
}, 60_000);

afterAll(async () => {
  await prisma.domainEvent.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@test.local` } } });
  await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
  await app.close();
});

async function revenue() {
  const response = await request(server)
    .get('/admin/metrics/revenue')
    .set('Cookie', bossCookie)
    .set('X-Forwarded-For', freshAddress())
    .expect(200);
  return response.body as {
    mrr: Record<string, number>;
    arr: Record<string, number>;
    atRisk: Record<string, number>;
    arpa: Record<string, number>;
    activeSubscriptions: number;
    trialingSubscriptions: number;
    payingSubscriptions: number;
  };
}

describe('recurring revenue', () => {
  it('counts a paid active subscription and leaves a trial and a past-due one out', async () => {
    const before = await revenue();

    const paying = await signUp('pagante');
    const trialing = await signUp('teste');
    const overdue = await signUp('atrasado');

    const monthly = await makePlan('mensal', 9900, 'BRL', 'month');

    await prisma.subscription.update({
      where: { workspaceId: paying },
      data: { planId: monthly, status: 'ACTIVE' },
    });
    await prisma.subscription.update({
      where: { workspaceId: trialing },
      data: { planId: monthly, status: 'TRIALING' },
    });
    await prisma.subscription.update({
      where: { workspaceId: overdue },
      data: { planId: monthly, status: 'PAST_DUE' },
    });

    const after = await revenue();

    // Exactly one of the three moved MRR.
    expect((after.mrr.BRL ?? 0) - (before.mrr.BRL ?? 0)).toBe(9900);
    // The trial has not paid, so counting it would make MRR a forecast.
    expect(after.trialingSubscriptions - before.trialingSubscriptions).toBe(1);
    // Past due is revenue at risk, reported where it is a warning rather than
    // hidden inside the headline.
    expect((after.atRisk.BRL ?? 0) - (before.atRisk.BRL ?? 0)).toBe(9900);
    expect(after.payingSubscriptions - before.payingSubscriptions).toBe(1);
  });

  it('divides a yearly price by twelve instead of counting it whole', async () => {
    const before = await revenue();

    const workspace = await signUp('anual');
    const yearly = await makePlan('anual', 118_800, 'BRL', 'year');
    await prisma.subscription.update({
      where: { workspaceId: workspace },
      data: { planId: yearly, status: 'ACTIVE' },
    });

    const after = await revenue();
    expect((after.mrr.BRL ?? 0) - (before.mrr.BRL ?? 0)).toBe(9900);
  });

  it('keeps currencies apart instead of adding them together', async () => {
    const before = await revenue();

    const workspace = await signUp('dolar');
    const usd = await makePlan('dolar', 4900, 'USD', 'month');
    await prisma.subscription.update({
      where: { workspaceId: workspace },
      data: { planId: usd, status: 'ACTIVE' },
    });

    const after = await revenue();

    // There is no honest way to add R$ 99 to US$ 49, so the total stays split.
    expect((after.mrr.USD ?? 0) - (before.mrr.USD ?? 0)).toBe(4900);
    expect(after.mrr.BRL ?? 0).toBe(before.mrr.BRL ?? 0);
  });

  it('reports ARR as twelve months of the same figure, per currency', async () => {
    const snapshot = await revenue();
    for (const [currency, cents] of Object.entries(snapshot.mrr)) {
      expect(snapshot.arr[currency]).toBe(cents * 12);
    }
  });

  it('ignores a free plan when averaging revenue per account', async () => {
    const snapshot = await revenue();
    // Free accounts are customers and zero revenue; dividing by them would drag
    // ARPA towards zero and say nothing about what customers pay.
    for (const [currency, cents] of Object.entries(snapshot.mrr)) {
      expect(snapshot.arpa[currency]).toBe(
        Math.round(cents / Math.max(snapshot.payingSubscriptions, 1)),
      );
    }
    expect(snapshot.payingSubscriptions).toBeLessThanOrEqual(snapshot.activeSubscriptions);
  });
});

describe('what moved over a period', () => {
  it('counts a signup that actually happened in the window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(server)
      .get(`/admin/metrics/growth?from=${today}&to=${today}`)
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    // This very test file registered several accounts a moment ago.
    expect(response.body.signups).toBeGreaterThan(0);
    expect(response.body.period.timeZone).toBe('America/Sao_Paulo');
  });

  it('values a cancellation at what the subscription was worth when it ended', async () => {
    const workspace = workspaces[0]!;
    const cancelled = await prisma.domainEvent.create({
      data: {
        id: uuidv7(),
        event: 'subscription.cancelled',
        workspaceId: workspace,
        // The plan may cost something different today; the event carries what it
        // was worth at the time, and that is what churn is measured from.
        amountCents: 4900,
        currency: 'BRL',
        occurredAt: new Date(),
      },
    });
    eventIds.push(cancelled.id);

    const today = new Date().toISOString().slice(0, 10);
    const response = await request(server)
      .get(`/admin/metrics/growth?from=${today}&to=${today}`)
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    expect(response.body.churnedSubscriptions).toBeGreaterThan(0);
    expect(response.body.revenueChurn.numerator).toBeGreaterThanOrEqual(4900);
  });

  it('marks a churn rate computed from too few accounts as unreliable', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(server)
      .get(`/admin/metrics/growth?from=${today}&to=${today}`)
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const churn = response.body.logoChurn;
    expect(churn).toHaveProperty('reliable');
    expect(churn).toHaveProperty('denominator');
    if (churn.denominator < 20) expect(churn.reliable).toBe(false);
  });

  it('does not report an LTV it cannot stand behind', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(server)
      .get(`/admin/metrics/growth?from=${today}&to=${today}`)
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    // On a test database the sample is tiny, so the honest answer is no figure
    // at all rather than a large number with two decimal places.
    expect(response.body.ltv).toEqual({});
  });
});

describe('a series has no invisible gaps', () => {
  it('returns every day in the window, including the empty ones', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);

    const response = await request(server)
      .get(
        `/admin/metrics/series?event=user.registered&from=${from.toISOString().slice(0, 10)}&to=${to
          .toISOString()
          .slice(0, 10)}`,
      )
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    // A chart that skips silent days draws a straight line through an outage.
    expect(response.body.length).toBeGreaterThanOrEqual(7);
    expect(response.body.every((point: { day: string }) => /^\d{4}-\d{2}-\d{2}$/.test(point.day))).toBe(
      true,
    );
  });

  it('refuses a series with no event named', async () => {
    await request(server)
      .get('/admin/metrics/series')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(422);
  });
});

describe('the window is never guessed', () => {
  it('refuses a malformed date instead of quietly using the last 30 days', async () => {
    const response = await request(server)
      .get('/admin/metrics/growth?from=ontem')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress());

    // Silently falling back is how somebody reads a number for the wrong period
    // and never finds out.
    expect(response.status).toBe(422);
  });

  it('refuses a window that runs backwards', async () => {
    await request(server)
      .get('/admin/metrics/growth?from=2026-05-01&to=2026-04-01')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(422);
  });

  it('refuses a window too long to answer', async () => {
    await request(server)
      .get('/admin/metrics/growth?from=2020-01-01&to=2026-01-01')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(422);
  });

  it('refuses a timezone that does not exist', async () => {
    await request(server)
      .get('/admin/metrics/growth?tz=Mars/Olympus')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(422);
  });
});

describe('the panel can explain every number it shows', () => {
  it('serves the definition behind each metric', async () => {
    const response = await request(server)
      .get('/admin/metrics/definitions')
      .set('Cookie', bossCookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);

    const mrr = response.body.find((d: { id: string }) => d.id === 'mrr');
    expect(mrr.formula['pt-BR']).toContain('12');
    expect(mrr.excludes['pt-BR']).toBeTruthy();
  });
});

describe('one definition, everywhere', () => {
  it('has no second way of turning a plan price into a recurring figure', () => {
    // The invariant is not "few files may ask what a plan is worth" — any screen
    // may. It is that none of them works it out itself. A file that divides a
    // price by twelve on its own is the start of the dashboard and the report
    // disagreeing, and neither being obviously wrong.
    const root = join(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(path);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;

        const source = readFileSync(path, 'utf8');
        // Arithmetic performed directly on a plan price, rather than handed to
        // the shared normalisation.
        if (/priceCents\s*[*/+-]|[*/+-]\s*[\w.]*priceCents/.test(source)) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });

  it('reads that definition from the shared package, not from a local copy', () => {
    const root = join(__dirname, '..');
    const callers: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(path);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        if (readFileSync(path, 'utf8').includes('monthlyCents(')) {
          callers.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);

    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) {
      const source = readFileSync(join(root, caller), 'utf8');
      // Every one of them imports it; none defines it.
      expect(source, caller).toMatch(/monthlyCents[\s\S]*from '@dmflow\/shared'/);
      expect(source, caller).not.toMatch(/function monthlyCents/);
    }
  });
});
