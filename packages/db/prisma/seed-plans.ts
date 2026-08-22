import { PrismaClient } from '../generated/client';
import { PLAN_DEFINITIONS, uuidv7 } from '@dmflow/shared';

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
