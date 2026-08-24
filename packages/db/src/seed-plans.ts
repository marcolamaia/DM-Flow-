import { PrismaClient } from '../generated/client';
import { PLAN_DEFINITIONS, uuidv7 } from '@dmflow/shared';

/**
 * Os planos, gravados no banco a partir da definição no código.
 *
 * Vive em `src/` e não em `prisma/` por um motivo prático: é compilado para
 * `dist/` e roda na fase de `release` da Heroku, junto com as migrations. O que
 * está em `prisma/` só roda por `@swc-node/register`, que é dependência de
 * desenvolvimento e a Heroku remove depois do build.
 *
 * Roda a cada deploy porque é `upsert`: cria o que falta, atualiza nome, preço
 * e limites, e não toca em assinatura nenhuma — as assinaturas apontam para o
 * plano por id.
 *
 * Isto não é dado de exemplo. Sem a linha do plano gratuito, `/auth/register`
 * não tem o que assinar e **todo cadastro devolve erro 500** — o primeiro
 * cliente de uma instalação nova bateria exatamente nisso. Foi assim que a
 * conferência automática achou isto, na primeira vez que rodou.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
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
      // Price and limits are product decisions that must be able to change without
      // touching existing subscriptions, which reference the plan by id.
      update: {
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        limits: plan.limits as never,
        features: plan.features,
        sortOrder: plan.sortOrder,
        isPublic: plan.isPublic,
      },
    });
  }
  const count = await prisma.plan.count();
  console.log(`plans seeded: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
