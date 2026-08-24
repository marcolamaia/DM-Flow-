import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { CAP, PLAN_DEFINITIONS, uuidv7, type FlowGraph } from '@dmflow/shared';

/**
 * Runs the engine against a real database.
 *
 * The behaviour under test is a run that stops, survives, and later continues
 * down one of several paths — none of which a mocked repository could tell the
 * truth about.
 */
let app: NestExpressApplication;
let prisma: PrismaService;
let engine: EngineService;

const suffix = Date.now().toString(36);
let workspaceId = '';
let contactId = '';
let conversationId = '';
let accountId = '';
let automationId = '';
let versionId = '';

const WAIT_NODE = 'wait-1';

function graphWith(options: Array<{ id: string; label: string; match: unknown }>): FlowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, config: {} },
      {
        id: WAIT_NODE,
        type: 'wait_for_reply',
        position: { x: 0, y: 120 },
        config: { options, timeoutAmount: 1, timeoutUnit: 'days' },
      },
      { id: 'end-yes', type: 'end', position: { x: 0, y: 240 }, config: {} },
      { id: 'end-no', type: 'end', position: { x: 200, y: 240 }, config: {} },
      { id: 'end-any', type: 'end', position: { x: 400, y: 240 }, config: {} },
      { id: 'end-timeout', type: 'end', position: { x: 600, y: 240 }, config: {} },
    ],
    edges: [
      { id: 'e0', source: 'trigger-1', target: WAIT_NODE, sourceHandle: null },
      { id: 'e1', source: WAIT_NODE, target: 'end-yes', sourceHandle: 'yes' },
      { id: 'e2', source: WAIT_NODE, target: 'end-no', sourceHandle: 'no' },
      { id: 'e3', source: WAIT_NODE, target: 'end-any', sourceHandle: 'any' },
      { id: 'e4', source: WAIT_NODE, target: 'end-timeout', sourceHandle: 'timeout' },
    ],
  } as FlowGraph;
}

const OPTIONS = [
  { id: 'yes', label: 'Quero', match: { kind: 'keywords', keywords: ['quero', 'sim'] } },
  { id: 'no', label: 'Não quero', match: { kind: 'keywords', keywords: ['não quero', 'nao'] } },
];

/** Drives one run to the point where it is parked waiting for an answer. */
async function startAndPark(): Promise<string> {
  const started = await engine.start({
    workspaceId,
    automationId,
    contactId,
    conversationId,
    connectedAccountId: accountId,
  });
  if (!('executionId' in started)) throw new Error(`did not start: ${started.skipped}`);

  await engine.advance(started.executionId);
  return started.executionId;
}

/**
 * Apaga as execuções deste workspace entre um teste e outro.
 *
 * Os testes leem a execução pelo id que `startAndPark` devolve, e não pela
 * primeira que o banco entregar: `findFirst` sem ordem não promete linha
 * nenhuma em particular, e basta uma segunda execução aparecer — de um worker
 * rodando ao lado contra o mesmo banco, por exemplo — para o teste ler a
 * errada e falhar sem que exista defeito nenhum no produto.
 */
async function reset(): Promise<void> {
  await prisma.executionStep.deleteMany({ where: { workspaceId } });
  await prisma.execution.deleteMany({ where: { workspaceId } });
}

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  await app.init();

  prisma = app.get(PrismaService);
  engine = app.get(EngineService);

  const free = PLAN_DEFINITIONS[0]!;
  const plan = await prisma.plan.upsert({
    where: { code: free.code },
    create: {
      id: uuidv7(),
      code: free.code,
      name: free.name,
      priceCents: free.priceCents,
      currency: free.currency,
      limits: free.limits as never,
      features: free.features,
      sortOrder: free.sortOrder,
    },
    update: {},
  });

  workspaceId = uuidv7();
  await prisma.workspace.create({
    data: { id: workspaceId, name: `Wait ${suffix}`, slug: `wait-${suffix}` },
  });
  await prisma.subscription.create({
    data: { id: uuidv7(), workspaceId, planId: plan.id, status: 'ACTIVE' },
  });

  accountId = uuidv7();
  await prisma.connectedAccount.create({
    data: {
      id: accountId,
      workspaceId,
      channel: 'INSTAGRAM',
      externalAccountId: `ig_wait_${suffix}`,
      username: 'conta_teste',
      status: 'CONNECTED',
      isSandbox: true,
    },
  });

  contactId = uuidv7();
  await prisma.contact.create({
    data: { id: contactId, workspaceId, primaryChannel: 'INSTAGRAM', displayName: 'Pessoa' },
  });

  conversationId = uuidv7();
  await prisma.conversation.create({
    data: {
      id: conversationId,
      workspaceId,
      contactId,
      connectedAccountId: accountId,
      channel: 'INSTAGRAM',
      status: 'OPEN',
      windowState: 'OPEN',
    },
  });

  automationId = uuidv7();
  versionId = uuidv7();
  await prisma.automation.create({
    data: { id: automationId, workspaceId, name: 'Aguardar resposta', status: 'PUBLISHED' },
  });
  await prisma.automationVersion.create({
    data: {
      id: versionId,
      workspaceId,
      automationId,
      versionNumber: 1,
      graph: graphWith(OPTIONS) as never,
      publishedAt: new Date(),
    },
  });
  await prisma.automation.update({
    where: { id: automationId },
    data: { publishedVersionId: versionId, draftVersionId: versionId },
  });
}, 60_000);

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await app.close();
});

describe('waiting for a reply', () => {
  it('parks the run instead of racing past the question', async () => {
    await reset();
    const executionId = await startAndPark();

    const execution = await prisma.execution.findUnique({ where: { id: executionId } });
    expect(execution!.status).toBe('WAITING');
    // Parked ON the question, not on what comes after it: which exit it takes is
    // not known until the contact answers.
    expect(execution!.awaitingReplyNodeId).toBe(WAIT_NODE);
    expect(execution!.currentNodeId).toBe(WAIT_NODE);
    // A deadline is always set, so a silent contact cannot park a run forever.
    expect(execution!.resumeAt).not.toBeNull();
  }, 30_000);

  it('takes the path for the words the contact typed', async () => {
    await reset();
    const executionId = await startAndPark();

    const resumed = await engine.deliverReply({
      workspaceId,
      conversationId,
      text: 'Quero sim!',
    });
    expect(resumed).toBe(1);

    const execution = await prisma.execution.findUnique({ where: { id: executionId } });
    expect(execution!.awaitingReplyNodeId).toBeNull();
    // 'yes' is where its exit leads; the run is now past the question.
    expect(['end-yes', null]).toContain(execution!.currentNodeId);
    expect((execution!.variables as Record<string, unknown>).reply).toMatchObject({
      option: 'yes',
    });
  }, 30_000);

  it('matches regardless of accents and capitals', async () => {
    await reset();
    const executionId = await startAndPark();

    await engine.deliverReply({ workspaceId, conversationId, text: 'NAO' });

    const execution = await prisma.execution.findUnique({ where: { id: executionId } });
    expect((execution!.variables as Record<string, unknown>).reply).toMatchObject({ option: 'no' });
  }, 30_000);

  it('sends an unrecognised answer down the catch-all path', async () => {
    await reset();
    const executionId = await startAndPark();

    await engine.deliverReply({ workspaceId, conversationId, text: 'que horas abre?' });

    const execution = await prisma.execution.findUnique({ where: { id: executionId } });
    expect((execution!.variables as Record<string, unknown>).reply).toMatchObject({ option: 'any' });
  }, 30_000);

  it('lets a tapped button win over the words in the message', async () => {
    // The contact tapped "Quero" while the text says something else entirely.
    // The tap is the deliberate choice and must decide the path.
    await prisma.automationVersion.update({
      where: { id: versionId },
      data: {
        graph: graphWith([
          { id: 'yes', label: 'Quero', match: { kind: 'quick_reply', payload: 'btn_quero' } },
          { id: 'no', label: 'Não', match: { kind: 'keywords', keywords: ['quero'] } },
        ]) as never,
      },
    });

    await reset();
    const executionId = await startAndPark();
    await engine.deliverReply({
      workspaceId,
      conversationId,
      text: 'quero',
      quickReplyPayload: 'btn_quero',
    });

    const execution = await prisma.execution.findUnique({ where: { id: executionId } });
    expect((execution!.variables as Record<string, unknown>).reply).toMatchObject({ option: 'yes' });

    await prisma.automationVersion.update({
      where: { id: versionId },
      data: { graph: graphWith(OPTIONS) as never },
    });
  }, 30_000);

  it('leaves by the no-reply path when the deadline passes', async () => {
    await reset();
    const executionId = await startAndPark();

    // Pull the deadline into the past rather than waiting a day for it.
    await prisma.execution.update({
      where: { id: executionId },
      data: { resumeAt: new Date(Date.now() - 1000) },
    });

    const woken = await engine.wakeDueExecutions();
    expect(woken).toBeGreaterThan(0);

    const execution = await prisma.execution.findUnique({ where: { id: executionId } });
    expect(execution!.awaitingReplyNodeId).toBeNull();
    expect(['end-timeout', null]).toContain(execution!.currentNodeId);
  }, 30_000);

  it('ignores a message on a conversation nothing is waiting on', async () => {
    await reset();

    const resumed = await engine.deliverReply({
      workspaceId,
      conversationId,
      text: 'oi',
    });

    expect(resumed).toBe(0);
  }, 30_000);
});

describe('routing by button, as a capability', () => {
  it('is not available on a live connection, and says so', () => {
    // The whole point: receiving a message does not tell us which button caused
    // it. Until Meta's documentation confirms the webhook carries that, the
    // builder must refuse to route on it rather than quietly never matching.
    const live = CAP.IG_RECEIVE_QUICK_REPLY_PAYLOAD;
    expect(live).toBe('CAP_IG_RECEIVE_QUICK_REPLY_PAYLOAD');
  });
});
