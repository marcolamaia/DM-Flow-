import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DmFlowExceptionFilter } from '../common/exception.filter';
import { RateLimitService } from '../common/rate-limit.service';
import { RedisService } from '../redis/redis.service';
import { loadEnv } from '../config/env';
import { CREDENTIAL_LIMIT } from '../common/decorators/rate-limit.decorator';

/**
 * Runs against real Redis. A mocked counter would pass whether or not the script
 * is atomic, whether or not the key ever expires, and whether or not the guard is
 * actually wired into the request path — which is the whole question here.
 */
let app: NestExpressApplication;
let server: Server;
let limiter: RateLimitService;
let redis: RedisService;

/**
 * Every HTTP case gets its own source address.
 *
 * Buckets are keyed by address, and the other test files sign in from the same
 * loopback address this one would otherwise use. Sharing a bucket across files
 * that run in parallel makes the counts non-deterministic — the test would
 * sometimes see a 429 several attempts early and sometimes not. A distinct
 * address per case removes the interference instead of papering over it.
 *
 * The run also gets its own randomised octets. Buckets outlive a test run — the
 * window is a minute — so a fixed set of addresses would make the second run
 * within that minute start against counters the first run had already spent.
 */
const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
function freshAddress(): string {
  addressCounter += 1;
  return `10.${runPrefix}.${addressCounter}`;
}

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.use(express.json());
  app.use(cookieParser(loadEnv().SESSION_SECRET));
  app.useGlobalFilters(new DmFlowExceptionFilter());
  // Required for X-Forwarded-For to reach req.ip, which is how each case gets
  // its own bucket. Production sets the same thing behind its load balancer.
  app.set('trust proxy', 1);
  await app.init();

  server = app.getHttpServer() as Server;
  limiter = app.get(RateLimitService);
  redis = app.get(RedisService);
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe('rate limit counter', () => {
  it('permits exactly the budget and refuses the request after it', async () => {
    const key = `test-budget-${Date.now()}`;
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await limiter.consume(key, 3, 60_000));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('anchors the window to the first request instead of sliding it forward', async () => {
    const key = `test-window-${Date.now()}`;
    const first = await limiter.consume(key, 5, 3_000);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const second = await limiter.consume(key, 5, 3_000);

    // A sliding window would have reset the countdown to 3 on the second call.
    expect(second.resetSeconds).toBeLessThanOrEqual(first.resetSeconds);
  });

  it('always sets an expiry, so a dead process cannot block a caller forever', async () => {
    const key = `test-ttl-${Date.now()}`;
    await limiter.consume(key, 1, 60_000);
    const ttl = await redis.client.pttl(`rl:${key}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('keeps separate keys independent', async () => {
    const stamp = Date.now();
    await limiter.consume(`test-a-${stamp}`, 1, 60_000);
    const other = await limiter.consume(`test-b-${stamp}`, 1, 60_000);

    expect(other.allowed).toBe(true);
  });
});

describe('rate limit guard', () => {
  it('refuses credential attempts past the budget with an actionable 429', async () => {
    const address = freshAddress();
    const attempt = () =>
      request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', address)
        .send({ email: 'nobody@test.local', password: 'wrong-password-1' });

    for (let i = 0; i < CREDENTIAL_LIMIT.limit; i += 1) {
      const response = await attempt();
      expect(response.status).toBe(401);
    }

    const refused = await attempt();
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
    expect(refused.body.error.retryable).toBe(true);
    // Without this header a client can only guess how long to wait.
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.body.error.userMessage).toBeTruthy();
  }, 30_000);

  it('cannot be escaped by rotating a made-up session cookie', async () => {
    const address = freshAddress();
    for (let i = 0; i < CREDENTIAL_LIMIT.limit; i += 1) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', address)
        // A different invented cookie every time. If the cookie were the key,
        // each of these would open a brand new budget.
        .set('Cookie', `dmflow_sid=invented-${i}-${Math.random()}`)
        .send({ email: 'nobody@test.local', password: 'wrong-password-1' });
    }

    const refused = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', address)
      .set('Cookie', `dmflow_sid=invented-final-${Math.random()}`)
      .send({ email: 'nobody@test.local', password: 'wrong-password-1' });

    expect(refused.status).toBe(429);
  }, 30_000);

  it('reports the budget on successful responses too, not only on refusal', async () => {
    const response = await request(server)
      .get('/workspaces/current')
      .set('X-Forwarded-For', freshAddress());

    expect(response.headers['ratelimit-limit']).toBeTruthy();
    expect(Number(response.headers['ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
    expect(Number(response.headers['ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('never throttles health checks, which decide whether we are considered alive', async () => {
    const response = await request(server)
      .get('/health/live')
      .set('X-Forwarded-For', freshAddress());

    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  });

  it('gives credential routes a tighter budget than ordinary ones', async () => {
    const address = freshAddress();
    const ordinary = await request(server)
      .get('/workspaces/current')
      .set('X-Forwarded-For', address);
    const credential = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', address)
      .send({ email: 'nobody@test.local', password: 'wrong-password-1' });

    expect(Number(credential.headers['ratelimit-limit'])).toBeLessThan(
      Number(ordinary.headers['ratelimit-limit']),
    );
  });
});
