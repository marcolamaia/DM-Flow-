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
import { PLAN_DEFINITIONS, maskEmail, uuidv7 } from '@dmflow/shared';

/**
 * Trocar o e-mail e excluir a conta.
 *
 * Duas operações raras e irreversíveis. O que este arquivo cobre não é o
 * caminho feliz — é o que acontece quando alguém tenta usá-las para roubar uma
 * conta, e o que acontece com os dados de terceiros quando alguém sai.
 */

let app: NestExpressApplication;
let server: Server;
let prisma: PrismaService;

const suffix = Date.now().toString(36);
const senha = 'senhaforte123';

const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

const criados: string[] = [];

async function signUp(label: string): Promise<{ cookie: string; userId: string; workspaceId: string; email: string }> {
  const email = `${label}-${suffix}@test.local`;
  const response = await request(server)
    .post('/auth/register')
    .set('X-Forwarded-For', freshAddress())
    .send({ email, password: senha, name: `Pessoa ${label}` })
    .expect(201);

  const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  criados.push(response.body.userId);
  return {
    cookie,
    userId: response.body.userId,
    workspaceId: response.body.workspaceId,
    email,
  };
}

const as = (cookie: string) => ({ cookie, ip: freshAddress() });

/** Uma conversa precisa de contato e de conta conectada; este atalho cria os dois. */
async function conversaCom(workspaceId: string, nome: string, assigneeId?: string) {
  const contaId = uuidv7();
  await prisma.connectedAccount.create({
    data: {
      id: contaId,
      workspaceId,
      channel: 'INSTAGRAM',
      externalAccountId: `ext-${contaId}`,
      username: `conta-${nome}`,
    },
  });

  const contatoId = uuidv7();
  await prisma.contact.create({
    data: { id: contatoId, workspaceId, displayName: nome, primaryChannel: 'INSTAGRAM' },
  });

  const conversaId = uuidv7();
  await prisma.conversation.create({
    data: {
      id: conversaId,
      workspaceId,
      contactId: contatoId,
      connectedAccountId: contaId,
      channel: 'INSTAGRAM',
      ...(assigneeId ? { assigneeId } : {}),
    },
  });

  return { conversaId, contatoId, contaId };
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
}, 60_000);

afterAll(async () => {
  // Sobra pouco: os próprios testes excluem quase tudo. O que sobrar sai aqui.
  await prisma.user.deleteMany({ where: { id: { in: criados } } }).catch(() => undefined);
  await app.close();
});

// ── Mascarar endereço ────────────────────────────────────────

describe('o endereço mostrado no aviso', () => {
  it('deixa reconhecer sem entregar o endereço inteiro', () => {
    expect(maskEmail('marcos@exemplo.com')).toBe('m****s@exemplo.com');
    // O domínio fica inteiro de propósito: é ele que denuncia o golpe.
    expect(maskEmail('a@b.com')).toBe('*@b.com');
    expect(maskEmail('ab@b.com')).toBe('**@b.com');
    expect(maskEmail('nao-e-email')).toBe('***');
  });

  it('não cresce sem limite com um endereço longo', () => {
    const mascarado = maskEmail('umnomedeusuariomuitolongomesmo@exemplo.com');
    expect(mascarado.length).toBeLessThan('umnomedeusuariomuitolongomesmo@exemplo.com'.length);
    expect(mascarado.endsWith('@exemplo.com')).toBe(true);
  });
});

// ── Trocar o e-mail ──────────────────────────────────────────

describe('trocar o e-mail', () => {
  it('recusa sem a senha certa, mesmo com a sessão na mão', async () => {
    const a = await signUp('troca-senha-errada');
    const r = as(a.cookie);

    await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: `novo-${suffix}@test.local`, password: 'senha-errada-mesmo' })
      .expect(401);

    // E nada foi criado: um pedido gravado já seria meio caminho andado.
    const pedidos = await prisma.emailChangeRequest.count({ where: { userId: a.userId } });
    expect(pedidos).toBe(0);
  });

  it('recusa trocar para o endereço que já é o da conta', async () => {
    const a = await signUp('troca-mesmo-email');
    const r = as(a.cookie);

    const resposta = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: a.email.toUpperCase(), password: senha })
      .expect(422);

    expect(resposta.body.error.code).toBe('EMAIL_CHANGE_SAME_ADDRESS');
  });

  it('recusa um endereço que já pertence a outra conta', async () => {
    const a = await signUp('troca-conflito-a');
    const b = await signUp('troca-conflito-b');
    const r = as(a.cookie);

    const resposta = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: b.email, password: senha })
      .expect(409);

    expect(resposta.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('NÃO troca o endereço no pedido — só quando alguém confirma', async () => {
    const a = await signUp('troca-so-depois');
    const r = as(a.cookie);
    const novo = `troca-so-depois-novo-${suffix}@test.local`;

    const pedido = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: novo, password: senha })
      .expect(201);

    // Esta é a defesa central. Se o endereço mudasse aqui, uma sessão roubada
    // bastaria para tomar a conta.
    const antes = await prisma.user.findUnique({ where: { id: a.userId } });
    expect(antes!.email).toBe(a.email);

    // A resposta devolve o endereço mascarado, nunca o endereço inteiro.
    expect(pedido.body.maskedNewEmail).not.toContain('troca-so-depois-novo');
    expect(pedido.body.maskedNewEmail).toContain('@test.local');

    // Com MAIL_TRANSPORT=log o token volta, e é assim que o teste confirma.
    const token = pedido.body.token as string;
    expect(token).toBeTruthy();

    await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token })
      .expect(201);

    const depois = await prisma.user.findUnique({ where: { id: a.userId } });
    expect(depois!.email).toBe(novo);
    // Quem clicou provou ter a caixa; exigir outra confirmação não provaria nada.
    expect(depois!.emailVerifiedAt).not.toBeNull();
  });

  it('desconecta todos os aparelhos ao confirmar', async () => {
    const a = await signUp('troca-derruba-sessao');
    const r = as(a.cookie);
    const novo = `troca-derruba-novo-${suffix}@test.local`;

    const pedido = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: novo, password: senha })
      .expect(201);

    await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: pedido.body.token })
      .expect(201);

    const vivas = await prisma.session.count({ where: { userId: a.userId, revokedAt: null } });
    expect(vivas).toBe(0);
  });

  it('não aceita o mesmo link duas vezes', async () => {
    const a = await signUp('troca-link-usado');
    const r = as(a.cookie);

    const pedido = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: `troca-link-usado-novo-${suffix}@test.local`, password: senha })
      .expect(201);

    await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: pedido.body.token })
      .expect(201);

    const segunda = await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: pedido.body.token })
      .expect(400);

    expect(segunda.body.error.code).toBe('EMAIL_CHANGE_TOKEN_INVALID');
  });

  it('um pedido novo derruba o link do pedido anterior', async () => {
    const a = await signUp('troca-dois-pedidos');
    const r = as(a.cookie);

    const primeiro = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: `troca-primeiro-${suffix}@test.local`, password: senha })
      .expect(201);

    await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ newEmail: `troca-segundo-${suffix}@test.local`, password: senha })
      .expect(201);

    const resposta = await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: primeiro.body.token })
      .expect(400);

    expect(resposta.body.error.code).toBe('EMAIL_CHANGE_TOKEN_INVALID');
  });

  it('trocar a senha mata um pedido de troca em aberto', async () => {
    // O roteiro: alguém invade, pede a troca do e-mail para um endereço dele, e
    // espera. O dono percebe e troca a senha. O link do invasor tem que morrer.
    const a = await signUp('troca-morre-com-senha');
    const r = as(a.cookie);

    const pedido = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: `invasor-${suffix}@test.local`, password: senha })
      .expect(201);

    await request(server)
      .post('/auth/password/change')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ currentPassword: senha, newPassword: 'outrasenhaforte456' })
      .expect(201);

    const resposta = await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: pedido.body.token })
      .expect(400);

    expect(resposta.body.error.code).toBe('EMAIL_CHANGE_TOKEN_INVALID');

    const dono = await prisma.user.findUnique({ where: { id: a.userId } });
    expect(dono!.email).toBe(a.email);
  });

  it('o dono consegue cancelar um pedido, e a tela sabe que ele existe', async () => {
    const a = await signUp('troca-cancelar');
    const r = as(a.cookie);

    const pedido = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: `troca-cancelar-novo-${suffix}@test.local`, password: senha })
      .expect(201);

    const pendente = await request(server)
      .get('/account/email/pending')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);
    expect(pendente.body.pending).not.toBeNull();
    expect(pendente.body.pending.maskedNewEmail).toContain('@test.local');

    await request(server)
      .post('/account/email/cancel')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(201);

    const depois = await request(server)
      .get('/account/email/pending')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);
    expect(depois.body.pending).toBeNull();

    await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: pedido.body.token })
      .expect(400);
  });

  it('recusa um link que expirou', async () => {
    const a = await signUp('troca-expirado');
    const r = as(a.cookie);

    const pedido = await request(server)
      .post('/account/email')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ newEmail: `troca-expirado-novo-${suffix}@test.local`, password: senha })
      .expect(201);

    // Puxa o prazo para trás em vez de esperar uma hora.
    await prisma.emailChangeRequest.updateMany({
      where: { userId: a.userId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const resposta = await request(server)
      .post('/account/email/confirm')
      .set('X-Forwarded-For', freshAddress())
      .send({ token: pedido.body.token })
      .expect(400);
    expect(resposta.body.error.code).toBe('EMAIL_CHANGE_TOKEN_INVALID');
  });
});

// ── Excluir a conta ──────────────────────────────────────────

describe('excluir a conta', () => {
  it('mostra antes o que vai ser destruído', async () => {
    const a = await signUp('excluir-previa');
    const r = as(a.cookie);

    await prisma.contact.create({
      data: {
        id: uuidv7(),
        workspaceId: a.workspaceId,
        displayName: 'Contato que vai junto',
        primaryChannel: 'INSTAGRAM',
      },
    });

    const previa = await request(server)
      .get('/account/deletion-preview')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .expect(200);

    expect(previa.body.blockers).toEqual([]);
    expect(previa.body.workspaces).toHaveLength(1);
    expect(previa.body.workspaces[0].outcome).toBe('deleted');
    // O número existe para a pessoa entender o tamanho do que está apagando.
    expect(previa.body.workspaces[0].contacts).toBe(1);
    expect(previa.body.sessions).toBeGreaterThan(0);
  });

  it('recusa sem a senha certa', async () => {
    const a = await signUp('excluir-senha-errada');
    const r = as(a.cookie);

    await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ password: 'nao-e-a-senha' })
      .expect(401);

    const ainda = await prisma.user.findUnique({ where: { id: a.userId } });
    expect(ainda).not.toBeNull();
  });

  it('apaga a pessoa, a área de trabalho e os contatos que estavam nela', async () => {
    const a = await signUp('excluir-tudo');
    const r = as(a.cookie);

    const contatoId = uuidv7();
    await prisma.contact.create({
      data: {
        id: contatoId,
        workspaceId: a.workspaceId,
        displayName: 'Some junto',
        primaryChannel: 'INSTAGRAM',
      },
    });

    await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ password: senha })
      .expect(200);

    expect(await prisma.user.findUnique({ where: { id: a.userId } })).toBeNull();
    expect(await prisma.workspace.findUnique({ where: { id: a.workspaceId } })).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: contatoId } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: a.userId } })).toBe(0);
  });

  it('recusa quando a pessoa é o único dono de uma área com outras pessoas', async () => {
    const dono = await signUp('excluir-ultimo-dono');
    const outro = await signUp('excluir-outro-membro');
    const r = as(dono.cookie);

    // Coloca outra pessoa dentro da área, sem ser dona.
    await prisma.workspaceMember.create({
      data: {
        id: uuidv7(),
        workspaceId: dono.workspaceId,
        userId: outro.userId,
        role: 'EDITOR',
      },
    });

    const previa = await request(server)
      .get('/account/deletion-preview')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .expect(200);

    expect(previa.body.blockers).toHaveLength(1);
    expect(previa.body.blockers[0].code).toBe('ACCOUNT_DELETE_LAST_OWNER');
    expect(previa.body.blockers[0].otherMembers).toBe(1);

    const tentativa = await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ password: senha })
      .expect(409);
    expect(tentativa.body.error.code).toBe('ACCOUNT_DELETE_LAST_OWNER');

    // E o mais importante: o trabalho da outra pessoa continua de pé.
    expect(await prisma.workspace.findUnique({ where: { id: dono.workspaceId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: dono.userId } })).not.toBeNull();
  });

  it('deixa sair quando existe outro dono, e a área continua viva', async () => {
    const primeiro = await signUp('excluir-tem-outro-dono');
    const segundo = await signUp('excluir-dono-que-fica');
    const r = as(primeiro.cookie);

    await prisma.workspaceMember.create({
      data: {
        id: uuidv7(),
        workspaceId: primeiro.workspaceId,
        userId: segundo.userId,
        role: 'OWNER',
      },
    });

    const previa = await request(server)
      .get('/account/deletion-preview')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .expect(200);
    expect(previa.body.blockers).toEqual([]);
    expect(previa.body.workspaces[0].outcome).toBe('left');

    await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ password: senha })
      .expect(200);

    expect(await prisma.workspace.findUnique({ where: { id: primeiro.workspaceId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: segundo.userId } })).not.toBeNull();
  });

  it('recusa enquanto houver assinatura paga que ainda cobra', async () => {
    const a = await signUp('excluir-assinatura');
    const r = as(a.cookie);

    const pago = PLAN_DEFINITIONS.find((p) => p.priceCents > 0)!;
    const plano = await prisma.plan.findUnique({ where: { code: pago.code } });

    await prisma.subscription.update({
      where: { workspaceId: a.workspaceId },
      data: { planId: plano!.id, status: 'ACTIVE' },
    });

    const previa = await request(server)
      .get('/account/deletion-preview')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .expect(200);

    expect(previa.body.blockers[0].code).toBe('ACCOUNT_DELETE_ACTIVE_SUBSCRIPTION');
    expect(previa.body.blockers[0].planName).toBe(pago.name);

    const tentativa = await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ password: senha })
      .expect(409);
    expect(tentativa.body.error.code).toBe('ACCOUNT_DELETE_ACTIVE_SUBSCRIPTION');

    // Uma assinatura já cancelada não impede mais.
    await prisma.subscription.update({
      where: { workspaceId: a.workspaceId },
      data: { status: 'CANCELED' },
    });
    const depois = await request(server)
      .get('/account/deletion-preview')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(200);
    expect(depois.body.blockers).toEqual([]);
  });

  it('o plano gratuito não impede ninguém de sair', async () => {
    const a = await signUp('excluir-plano-gratis');
    const r = as(a.cookie);

    const previa = await request(server)
      .get('/account/deletion-preview')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .expect(200);

    expect(previa.body.blockers).toEqual([]);
  });

  it('preserva a anotação do time quando quem escreveu vai embora', async () => {
    // O defeito que este teste tranca: com Cascade na autoria, uma pessoa
    // saindo levava junto anotações que são do time e continuam valendo.
    const dono = await signUp('excluir-nota-dono');
    const autor = await signUp('excluir-nota-autor');

    await prisma.workspaceMember.create({
      data: { id: uuidv7(), workspaceId: dono.workspaceId, userId: autor.userId, role: 'AGENT' },
    });

    const { conversaId } = await conversaCom(dono.workspaceId, 'Cliente');
    const notaId = uuidv7();
    await prisma.conversationNote.create({
      data: {
        id: notaId,
        workspaceId: dono.workspaceId,
        conversationId: conversaId,
        authorUserId: autor.userId,
        body: 'Cliente irritado — não oferecer upgrade agora.',
      },
    });

    await request(server)
      .delete('/account')
      .set('Cookie', as(autor.cookie).cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ password: senha })
      .expect(200);

    const nota = await prisma.conversationNote.findUnique({ where: { id: notaId } });
    expect(nota).not.toBeNull();
    expect(nota!.body).toBe('Cliente irritado — não oferecer upgrade agora.');
    // Sem autor, e é isso mesmo: a pessoa saiu, o registro dela some, a
    // informação de trabalho fica.
    expect(nota!.authorUserId).toBeNull();
  });

  it('preserva a conversa atribuída a quem saiu, sem responsável', async () => {
    const dono = await signUp('excluir-atrib-dono');
    const agente = await signUp('excluir-atrib-agente');

    await prisma.workspaceMember.create({
      data: { id: uuidv7(), workspaceId: dono.workspaceId, userId: agente.userId, role: 'AGENT' },
    });

    const { conversaId } = await conversaCom(dono.workspaceId, 'Cliente 2', agente.userId);

    await request(server)
      .delete('/account')
      .set('Cookie', as(agente.cookie).cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ password: senha })
      .expect(200);

    const conversa = await prisma.conversation.findUnique({ where: { id: conversaId } });
    expect(conversa).not.toBeNull();
    expect(conversa!.assigneeId).toBeNull();
  });

  it('preserva a trilha de auditoria das áreas que continuam existindo', async () => {
    const dono = await signUp('excluir-audit-dono');
    const membro = await signUp('excluir-audit-membro');

    await prisma.workspaceMember.create({
      data: { id: uuidv7(), workspaceId: dono.workspaceId, userId: membro.userId, role: 'EDITOR' },
    });

    await request(server)
      .delete('/account')
      .set('Cookie', as(membro.cookie).cookie)
      .set('X-Forwarded-For', freshAddress())
      .send({ password: senha })
      .expect(200);

    const trilha = await prisma.auditLog.findFirst({
      where: { workspaceId: dono.workspaceId, action: 'workspace.member_left' },
    });
    expect(trilha).not.toBeNull();
    // Sem o autor: a pessoa não existe mais. O fato, sim.
    expect(trilha!.actorUserId).toBeNull();
  });

  it('a sessão para de valer imediatamente depois de excluir', async () => {
    const a = await signUp('excluir-sessao-morta');
    const r = as(a.cookie);

    await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ password: senha })
      .expect(200);

    await request(server)
      .get('/auth/me')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', freshAddress())
      .expect(401);
  });

  it('registra o evento de domínio, sem apontar para a área já apagada', async () => {
    const a = await signUp('excluir-evento');
    const r = as(a.cookie);

    await request(server)
      .delete('/account')
      .set('Cookie', r.cookie)
      .set('X-Forwarded-For', r.ip)
      .send({ password: senha })
      .expect(200);

    const evento = await prisma.domainEvent.findFirst({
      where: { event: 'user.deleted', userId: a.userId },
    });
    expect(evento).not.toBeNull();
    // Apontar para a área apagada quebraria a chave estrangeira do evento.
    expect(evento!.workspaceId).toBeNull();
    expect((evento!.properties as Record<string, number>).workspacesDeleted).toBe(1);
  });
});
