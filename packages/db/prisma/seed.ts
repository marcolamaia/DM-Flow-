import { createCipheriv, randomBytes } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { PLAN_DEFINITIONS, uuidv7 } from '@dmflow/shared';

const prisma = new PrismaClient();

/**
 * Seeds a workspace that demonstrates the whole product immediately: a sandbox
 * Instagram account, contacts, tags, fields, and a published comment-to-DM
 * automation. A demo where nothing has run teaches nothing.
 */

/**
 * Mirrors SecretBox in the API. The seed has to produce a credential the running
 * app can actually decrypt, otherwise the demo automation fails on its first send
 * with a token error — which is the engine behaving correctly on bad seed data.
 */
function encryptSecret(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters to seed a channel token');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

const DEMO_EMAIL = process.env.SEED_EMAIL ?? 'demo@dmflow.app';
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'dmflow-demo-2026';

async function argonHash(password: string): Promise<string> {
  const argon2 = await import('argon2');
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function main(): Promise<void> {
  // ── Plans
  for (const plan of PLAN_DEFINITIONS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: {
        id: uuidv7(),
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        limits: plan.limits as never,
        features: plan.features,
        sortOrder: plan.sortOrder,
        isPublic: plan.isPublic,
      },
      update: {
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        limits: plan.limits as never,
        features: plan.features,
      },
    });
  }
  console.log(`✓ plans: ${PLAN_DEFINITIONS.length}`);

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`✓ demo user already exists (${DEMO_EMAIL}) — nothing else to seed`);
    return;
  }

  const proPlan = await prisma.plan.findUnique({ where: { code: 'pro' } });
  const userId = uuidv7();
  const workspaceId = uuidv7();

  await prisma.user.create({
    data: {
      id: userId,
      email: DEMO_EMAIL,
      passwordHash: await argonHash(DEMO_PASSWORD),
      name: 'Conta Demo',
      locale: 'pt-BR',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.workspace.create({
    data: { id: workspaceId, name: 'Loja Demo', slug: `loja-demo-${randomBytes(3).toString('hex')}` },
  });
  await prisma.workspaceMember.create({
    data: { id: uuidv7(), workspaceId, userId, role: 'OWNER' },
  });
  await prisma.subscription.create({
    data: { id: uuidv7(), workspaceId, planId: proPlan!.id, status: 'ACTIVE' },
  });
  console.log(`✓ workspace: Loja Demo`);

  // ── Sandbox channel. Marked isSandbox so the capability registry serves the
  // simulator's entries rather than claiming anything about the live platform.
  const accountId = uuidv7();
  await prisma.connectedAccount.create({
    data: {
      id: accountId,
      workspaceId,
      channel: 'INSTAGRAM',
      externalAccountId: 'ig_sandbox_loja_demo',
      username: 'loja_demo',
      displayName: 'Loja Demo',
      accountType: 'BUSINESS',
      grantedScopes: [],
      status: 'CONNECTED',
      accessTokenEnc: encryptSecret(`sandbox-token-${randomBytes(16).toString('hex')}`),
      isSandbox: true,
      connectedByUserId: userId,
      webhookVerifiedAt: new Date(),
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });
  console.log('✓ sandbox instagram account: @loja_demo');

  // ── Taxonomy
  const tags = await Promise.all(
    [
      { name: 'Lead quente', color: '#ef4444' },
      { name: 'Cliente', color: '#22c55e' },
      { name: 'Aguardando pagamento', color: '#f59e0b' },
    ].map((tag) =>
      prisma.tag.create({ data: { id: uuidv7(), workspaceId, name: tag.name, color: tag.color } }),
    ),
  );

  const fields = await Promise.all(
    [
      { key: 'score', label: 'Score', type: 'NUMBER' as const },
      { key: 'produto_interesse', label: 'Produto de interesse', type: 'TEXT' as const },
    ].map((field) =>
      prisma.customField.create({
        data: { id: uuidv7(), workspaceId, key: field.key, label: field.label, type: field.type },
      }),
    ),
  );
  console.log(`✓ tags: ${tags.length}, custom fields: ${fields.length}`);

  await prisma.segment.create({
    data: {
      id: uuidv7(),
      workspaceId,
      name: 'Leads quentes sem compra',
      filter: {
        kind: 'and',
        children: [
          { kind: 'condition', source: 'tag', field: tags[0]!.id, operator: 'is_set' },
          {
            kind: 'not',
            child: { kind: 'condition', source: 'tag', field: tags[1]!.id, operator: 'is_set' },
          },
        ],
      } as never,
    },
  });

  // ── A published automation, ready to fire on a real webhook.
  const automationId = uuidv7();
  const versionId = uuidv7();

  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 260, y: 40 }, config: {}, label: 'Comentário' },
      {
        id: 'm1',
        type: 'send_message',
        position: { x: 260, y: 190 },
        config: {
          blocks: [
            {
              type: 'text',
              text: 'Oi {{contact.displayName}}! Vi seu comentário 💜 Aqui está o link: exemplo.com/oferta',
            },
          ],
          quickReplies: [{ id: 'qr1', title: 'Quero saber mais' }],
          asPrivateReply: true,
        },
        label: 'Responder no direct',
      },
      {
        id: 'a1',
        type: 'add_tag',
        position: { x: 260, y: 350 },
        config: { tagId: tags[0]!.id },
        label: 'Marcar como lead',
      },
      {
        id: 'f1',
        type: 'set_custom_field',
        position: { x: 260, y: 500 },
        config: { customFieldId: fields[0]!.id, value: 80 },
        label: 'Score 80',
      },
      { id: 'e1', type: 'end', position: { x: 260, y: 650 }, config: {}, label: 'Fim' },
    ],
    edges: [
      { id: 'e-t1-m1', source: 't1', target: 'm1', sourceHandle: null },
      { id: 'e-m1-a1', source: 'm1', target: 'a1', sourceHandle: null },
      { id: 'e-a1-f1', source: 'a1', target: 'f1', sourceHandle: null },
      { id: 'e-f1-e1', source: 'f1', target: 'e1', sourceHandle: null },
    ],
  };

  await prisma.automation.create({
    data: {
      id: automationId,
      workspaceId,
      name: 'Comentário vira DM',
      description: 'Quem comenta "quero" recebe o link no direct.',
      status: 'PUBLISHED',
      createdById: userId,
    },
  });
  await prisma.automationVersion.create({
    data: {
      id: versionId,
      workspaceId,
      automationId,
      versionNumber: 1,
      graph: graph as never,
      publishedAt: new Date(),
      publishedById: userId,
    },
  });
  await prisma.automation.update({
    where: { id: automationId },
    data: { publishedVersionId: versionId, draftVersionId: versionId },
  });
  await prisma.trigger.create({
    data: {
      id: uuidv7(),
      workspaceId,
      automationId,
      automationVersionId: versionId,
      type: 'ig_comment',
      channel: 'INSTAGRAM',
      connectedAccountId: accountId,
      config: {
        includeKeywords: ['quero', 'link', 'preço'],
        excludeKeywords: [],
        matchMode: 'contains',
        caseSensitive: false,
        mediaIds: [],
        replyPublicly: false,
      } as never,
      matchPriority: 75,
    },
  });
  console.log('✓ published automation: "Comentário vira DM"');

  console.log(`
──────────────────────────────────────────────
  DM FLOW is seeded.

  Sign in at http://localhost:3000/login
    email    ${DEMO_EMAIL}
    password ${DEMO_PASSWORD}

  Then send a simulated Instagram comment:
    pnpm --filter @dmflow/api simulate:comment
──────────────────────────────────────────────`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
