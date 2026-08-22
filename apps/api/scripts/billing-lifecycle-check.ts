import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/billing/billing.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const billing = app.get(BillingService);
  const prisma = app.get(PrismaService);

  const ws = await prisma.workspace.findFirst({ where: { name: 'Marcos Studio' } });
  if (!ws) throw new Error('workspace not found');

  const show = async (label: string) => {
    const w = await prisma.workspace.findUnique({ where: { id: ws.id } });
    const s = await prisma.subscription.findUnique({ where: { workspaceId: ws.id } });
    const running = await prisma.execution.count({
      where: { workspaceId: ws.id, status: { in: ['RUNNING', 'WAITING'] } },
    });
    console.log(
      `  ${label.padEnd(34)} workspace=${w!.status.padEnd(9)} subscription=${s!.status.padEnd(9)} reason=${String(w!.suspensionReason)} runningExecutions=${running}`,
    );
  };

  console.log('\n[1] Baseline');
  await show('healthy');

  console.log('\n[2] Payment fails -> PAST_DUE, grace begins');
  await prisma.subscription.update({
    where: { workspaceId: ws.id },
    data: { status: 'PAST_DUE', pastDueSince: new Date(), lastPaymentError: 'Cartão recusado pelo emissor.' },
  });
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { status: 'PAST_DUE', suspensionReason: 'payment_failed' },
  });
  await show('right after failure');

  console.log('\n[3] Sweep runs while still inside the grace window');
  const duringGrace = await billing.suspendOverdueWorkspaces();
  console.log(`  suspended this sweep: ${duringGrace} (expected 0 — grace has not elapsed)`);
  await show('still inside grace');

  console.log('\n[4] Grace elapses (8 days ago), sweep runs again');
  await prisma.subscription.update({
    where: { workspaceId: ws.id },
    data: { pastDueSince: new Date(Date.now() - 8 * 86_400_000) },
  });
  const afterGrace = await billing.suspendOverdueWorkspaces();
  console.log(`  suspended this sweep: ${afterGrace} (expected 1)`);
  await show('after grace elapsed');

  console.log('\n[5] What the customer is told');
  const sub = await billing.getSubscription(ws.id);
  console.log('  workspaceStatus :', sub!.workspaceStatus);
  console.log('  lastPaymentError:', sub!.lastPaymentError);
  console.log('  graceDaysLeft   :', sub!.graceDaysRemaining);

  console.log('\n[6] Data is still there while suspended');
  const [contacts, automations, messages] = await Promise.all([
    prisma.contact.count({ where: { workspaceId: ws.id, deletedAt: null } }),
    prisma.automation.count({ where: { workspaceId: ws.id, deletedAt: null } }),
    prisma.message.count({ where: { workspaceId: ws.id } }),
  ]);
  console.log(`  contacts=${contacts} automations=${automations} messages=${messages} (nothing deleted)`);

  console.log('\n[7] Payment succeeds -> reactivated');
  await prisma.subscription.update({
    where: { workspaceId: ws.id },
    data: { status: 'ACTIVE', pastDueSince: null, lastPaymentError: null },
  });
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null },
  });
  await show('after regularising');

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
