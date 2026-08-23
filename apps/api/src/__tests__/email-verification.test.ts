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
import { MailService } from '../mail/mail.service';
import { loadEnv } from '../config/env';
import { PLAN_DEFINITIONS, uuidv7 } from '@dmflow/shared';
import { renderInvitation, renderPasswordReset } from '../mail/templates';

let app: NestExpressApplication;
let server: Server;
let prisma: PrismaService;
let mail: MailService;

const suffix = Date.now().toString(36);
const user = {
  email: `verify-${suffix}@test.local`,
  password: 'senhaforte123',
  name: 'Pessoa Sem Confirmar',
};

let cookie = '';
let workspaceId = '';

/** Own address space per case, so the credential rate limit does not decide the result. */
const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.use(express.json());
  app.use(cookieParser(loadEnv().SESSION_SECRET));
  app.useGlobalFilters(new DmFlowExceptionFilter());
  app.set('trust proxy', 1);
  await app.init();

  server = app.getHttpServer() as Server;
  prisma = app.get(PrismaService);
  mail = app.get(MailService);

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

  const response = await request(server)
    .post('/auth/register')
    .set('X-Forwarded-For', freshAddress())
    .send(user)
    .expect(201);

  cookie = (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  workspaceId = response.body.workspaceId;
}, 60_000);

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { email: user.email } });
  await app.close();
});

describe('email verification', () => {
  it('issues a verification token on signup rather than trusting the address', async () => {
    const record = await prisma.user.findUnique({ where: { email: user.email } });
    const tokens = await prisma.emailVerificationToken.findMany({
      where: { userId: record!.id },
    });

    expect(record!.emailVerifiedAt).toBeNull();
    expect(tokens).toHaveLength(1);
    // Stored hashed, like every other opaque token: a database dump must not
    // hand out working verification links.
    expect(tokens[0]!.tokenHash).not.toContain('-');
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('blocks publishing an automation until the address is confirmed', async () => {
    const created = await request(server)
      .post('/automations')
      .set('Cookie', cookie)
      .set('x-dmflow-workspace', workspaceId)
      .set('X-Forwarded-For', freshAddress())
      .send({ name: 'Fluxo de teste' })
      .expect(201);

    const response = await request(server)
      .post(`/automations/${created.body.id}/publish`)
      .set('Cookie', cookie)
      .set('x-dmflow-workspace', workspaceId)
      .set('X-Forwarded-For', freshAddress())
      .expect(403);

    expect(response.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    // The message has to say what to do next, not merely that the door is shut.
    expect(response.body.error.remediation.action).toBe('resend_verification');
  });

  it('leaves everything else reachable, so an unconfirmed account is not locked out', async () => {
    await request(server)
      .get('/contacts')
      .set('Cookie', cookie)
      .set('x-dmflow-workspace', workspaceId)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);
  });

  it('confirms the address when the token is presented, and only once', async () => {
    const resend = await request(server)
      .post('/auth/email/verify/resend')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(201);

    const token = resend.body.token as string;
    expect(token).toBeTruthy();

    await request(server)
      .post('/auth/email/verify')
      .set('X-Forwarded-For', freshAddress())
      .send({ token })
      .expect(201);

    const record = await prisma.user.findUnique({ where: { email: user.email } });
    expect(record!.emailVerifiedAt).not.toBeNull();

    // Replaying a used link must not work — otherwise a leaked link stays live.
    const replay = await request(server)
      .post('/auth/email/verify')
      .set('X-Forwarded-For', freshAddress())
      .send({ token })
      .expect(400);
    expect(replay.body.error.code).toBe('VERIFICATION_TOKEN_INVALID');
  });

  it('permits publishing once the address is confirmed', async () => {
    const created = await request(server)
      .post('/automations')
      .set('Cookie', cookie)
      .set('x-dmflow-workspace', workspaceId)
      .set('X-Forwarded-For', freshAddress())
      .send({ name: 'Fluxo publicável' })
      .expect(201);

    const response = await request(server)
      .post(`/automations/${created.body.id}/publish`)
      .set('Cookie', cookie)
      .set('x-dmflow-workspace', workspaceId)
      .set('X-Forwarded-For', freshAddress());

    // Publishing may still be refused on the flow's own merits — an empty draft
    // has nothing to run. What must not happen any more is a verification block.
    expect(response.body.error?.code).not.toBe('EMAIL_NOT_VERIFIED');
  });

  it('invalidates an outstanding token when a new one is issued', async () => {
    const record = await prisma.user.findUnique({ where: { email: user.email } });
    await prisma.user.update({
      where: { id: record!.id },
      data: { emailVerifiedAt: null },
    });

    const first = await request(server)
      .post('/auth/email/verify/resend')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(201);
    const second = await request(server)
      .post('/auth/email/verify/resend')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(201);

    // Without this, pressing "resend" would keep widening the window instead of
    // moving it, leaving every earlier link live until it expired on its own.
    await request(server)
      .post('/auth/email/verify')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: first.body.token })
      .expect(400);

    await request(server)
      .post('/auth/email/verify')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: second.body.token })
      .expect(201);
  });
});

describe('signup', () => {
  it('accepts an untouched optional workspace name', async () => {
    // The form sends '' for a field the person never touched. Rejecting that made
    // signup fail on a field the interface labels as optional.
    const email = `optional-${suffix}@test.local`;
    const response = await request(server)
      .post('/auth/register')
      .set('X-Forwarded-For', freshAddress())
      .send({ email, password: 'senhaforte123', name: 'Sem Workspace', workspaceName: '' })
      .expect(201);

    expect(response.body.workspaceId).toBeTruthy();
    await prisma.workspace.deleteMany({ where: { id: response.body.workspaceId } });
    await prisma.user.deleteMany({ where: { email } });
  });

  it('still refuses a workspace name that was typed but is too short', async () => {
    const response = await request(server)
      .post('/auth/register')
      .set('X-Forwarded-For', freshAddress())
      .send({
        email: `short-${suffix}@test.local`,
        password: 'senhaforte123',
        name: 'Nome Curto',
        workspaceName: 'x',
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('mail rendering', () => {
  it('escapes user-supplied names instead of putting markup in somebody inbox', () => {
    const rendered = renderInvitation({
      locale: 'pt-BR',
      inviterName: '<script>alert(1)</script>',
      workspaceName: 'Loja "do" Zé & Cia',
      role: 'EDITOR',
      url: 'https://example.test/accept-invite?token=abc',
      expiresHours: 168,
    });

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&quot;do&quot;');
    expect(rendered.html).toContain('&amp;');
  });

  it('writes both languages, not one with the other as a fallback', () => {
    const pt = renderPasswordReset({ locale: 'pt-BR', url: 'https://x.test/r', expiresHours: 1 });
    const en = renderPasswordReset({ locale: 'en', url: 'https://x.test/r', expiresHours: 1 });

    expect(pt.subject).not.toBe(en.subject);
    expect(pt.text).toContain('senha');
    expect(en.text).toContain('password');
  });

  it('always carries a plain-text part, for clients that refuse HTML', () => {
    const rendered = renderPasswordReset({
      locale: 'pt-BR',
      url: 'https://x.test/reset?token=abc',
      expiresHours: 1,
    });

    expect(rendered.text).toContain('https://x.test/reset?token=abc');
    expect(rendered.text).not.toContain('<');
  });
});

describe('mail transport', () => {
  it('reports non-delivery under the log transport instead of pretending to send', async () => {
    const result = await mail.send('someone@test.local', {
      subject: 'assunto',
      text: 'corpo https://example.test/link',
      html: '<p>corpo</p>',
    });

    // The environment check refuses this transport in production precisely
    // because it does not deliver; here it must at least say so.
    expect(loadEnv().MAIL_TRANSPORT).toBe('log');
    expect(result.delivered).toBe(false);
    expect(result.previewUrl).toBe('https://example.test/link');
  });
});
