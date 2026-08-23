import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard against the classic multi-tenant leak: a list, count, update-many
 * or delete-many query that forgets its workspace filter and quietly returns —
 * or worse, modifies — another customer's rows.
 *
 * Prisma 6 dropped `$use` middleware, and wrapping the whole client in a Proxy to
 * intercept queries risks breaking transactions and raw SQL in an app that is
 * otherwise stable. So the enforcement lives here instead: it costs nothing at
 * runtime, fails in CI, and forces every deliberate cross-tenant query to carry a
 * written justification rather than being indistinguishable from a mistake.
 */

/** Models whose rows belong to exactly one workspace. */
const TENANT_MODELS = [
  'connectedAccount',
  'contact',
  'contactIdentity',
  'conversation',
  'message',
  'conversationNote',
  'tag',
  'customField',
  'customFieldValue',
  'segment',
  'automation',
  'automationVersion',
  'trigger',
  'execution',
  'executionStep',
  'idempotencyRecord',
  'outboundWebhook',
  'outboundWebhookDelivery',
  'apiKey',
  'dataSubjectRequest',
  'usageCounter',
  'subscription',
  'invitation',
  'workspaceMember',
];

/** Operations that can touch many rows at once, where a missing filter is a leak. */
const BULK_OPERATIONS = [
  'findMany',
  'findFirst',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
];

/**
 * Queries that are deliberately not filtered by workspaceId, each with the reason
 * it is safe. Adding an entry here is a decision someone has to defend in review —
 * which is the point: a leak and an intentional sweep must never look alike.
 */
const JUSTIFIED_SYSTEM_QUERIES: Array<{ file: string; model: string; operation: string; why: string }> = [
  {
    file: 'src/admin/admin-subscriptions.service.ts',
    model: 'subscription',
    operation: 'findMany',
    why: "Platform-wide by definition: this is the administrative list of who pays what, across every tenant. Reachable only through AdminGuard, and personal data within it is gated separately behind admin.users.pii.",
  },
  {
    file: 'src/admin/metrics.service.ts',
    model: 'subscription',
    operation: 'findMany',
    why: "Platform-wide by definition: MRR is the total across every tenant, and a per-workspace filter would make it a different number. Reachable only through AdminGuard, which requires a platform-admin grant held in its own table and re-read from the database on every request. Returns totals, never one tenant's records.",
  },
  {
    file: 'src/auth/auth.controller.ts',
    model: 'workspaceMember',
    operation: 'findMany',
    why: 'Lists the workspaces the authenticated user belongs to, scoped by their own userId — which is exactly what the answer is about.',
  },
  {
    file: 'src/automations/automations.service.ts',
    model: 'trigger',
    operation: 'updateMany',
    why: 'Repoints triggers at a newly published version. Scoped by automationId, already verified by assertTenant at the top of publish().',
  },
  {
    file: 'src/automations/automations.service.ts',
    model: 'execution',
    operation: 'count',
    why: 'Counts in-flight runs of one automation before deleting it. Scoped by automationId, already verified by assertTenant.',
  },
  {
    file: 'src/automations/automations.service.ts',
    model: 'execution',
    operation: 'updateMany',
    why: 'Cancels in-flight runs when an automation is deleted, so no contact is left stuck mid-conversation. Scoped by automationId, already verified by assertTenant.',
  },
  {
    file: 'src/contacts/contacts.service.ts',
    model: 'contactIdentity',
    operation: 'updateMany',
    why: 'Contact merge: moves identities to the primary contact. Both contacts were verified by assertTenant before the transaction opened.',
  },
  {
    file: 'src/contacts/contacts.service.ts',
    model: 'conversation',
    operation: 'updateMany',
    why: 'Contact merge: moves conversations to the primary contact. Both contacts were verified by assertTenant before the transaction opened.',
  },
  {
    file: 'src/contacts/contacts.service.ts',
    model: 'customFieldValue',
    operation: 'deleteMany',
    why: 'Contact merge: clears the absorbed contact values after copying the ones the primary lacked. Both contacts were verified by assertTenant.',
  },
  {
    file: 'src/contacts/contacts.service.ts',
    model: 'execution',
    operation: 'updateMany',
    why: 'Contact merge: reassigns execution history to the primary contact. Both contacts were verified by assertTenant before the transaction opened.',
  },
  {
    file: 'src/engine/engine.service.ts',
    model: 'execution',
    operation: 'findMany',
    why: 'Scheduler sweep: wakes due delays across every workspace by design. Each execution carries its own workspaceId into the run.',
  },
  {
    file: 'src/engine/engine.service.ts',
    model: 'execution',
    operation: 'updateMany',
    why: 'Engine state transitions scoped by execution primary key plus lockVersion. The optimistic version check is what makes the write safe; a workspace filter would add nothing to a single-row update by UUID.',
  },
  {
    file: 'src/inbox/inbox.service.ts',
    model: 'message',
    operation: 'findMany',
    why: 'Thread read scoped by conversationId, where the parent conversation was already verified by assertTenant.',
  },
  {
    file: 'src/worker.ts',
    model: 'idempotencyRecord',
    operation: 'deleteMany',
    why: 'Maintenance sweep: removes expired idempotency records across every workspace by design, matching only rows whose own expiry has passed.',
  },
  {
    file: 'src/automations/automations.service.ts',
    model: 'automationVersion',
    operation: 'findFirst',
    why: 'Finds the latest version number when branching a new draft. Scoped by automationId, already verified by assertTenant in saveDraft().',
  },
  {
    file: 'src/automations/automations.service.ts',
    model: 'automationVersion',
    operation: 'findMany',
    why: 'Version history for one automation. Scoped by automationId, already verified by assertTenant in listVersions().',
  },
  {
    file: 'src/automations/automations.service.ts',
    model: 'trigger',
    operation: 'findMany',
    why: 'Reads the triggers attached to one automation during validation. Scoped by automationId, already verified by assertTenant.',
  },
  {
    file: 'src/contacts/contacts.service.ts',
    model: 'customFieldValue',
    operation: 'findMany',
    why: 'Contact merge: reads the absorbed contact values to copy the ones the primary lacks. Both contacts were verified by assertTenant.',
  },
  {
    file: 'src/integrations/outbound-webhooks.service.ts',
    model: 'outboundWebhookDelivery',
    operation: 'findMany',
    why: 'Delivery history scoped by outboundWebhookId, already verified by assertTenant on the parent webhook.',
  },
];

interface Finding {
  file: string;
  model: string;
  operation: string;
  snippet: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Reads the argument list of a call, following nested braces and parens. */
function readArguments(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return '';
}

function scan(): Finding[] {
  const root = join(__dirname, '..');
  const findings: Finding[] = [];

  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const relativePath = relative(join(root, '..'), file).replace(/\\/g, '/');

    for (const model of TENANT_MODELS) {
      for (const operation of BULK_OPERATIONS) {
        const pattern = new RegExp(`\\.${model}\\.${operation}\\s*\\(`, 'g');
        for (const match of source.matchAll(pattern)) {
          const openParen = match.index! + match[0].length - 1;
          const args = readArguments(source, openParen);
          if (args.includes('workspaceId')) continue;

          findings.push({
            file: relativePath,
            model,
            operation,
            snippet: args.replace(/\s+/g, ' ').slice(0, 100),
          });
        }
      }
    }
  }

  return findings;
}

describe('tenant scoping', () => {
  it('has no unjustified workspace-wide query on a tenant-scoped model', () => {
    const findings = scan();

    const unjustified = findings.filter(
      (finding) =>
        !JUSTIFIED_SYSTEM_QUERIES.some(
          (allowed) =>
            allowed.file === finding.file &&
            allowed.model === finding.model &&
            allowed.operation === finding.operation,
        ),
    );

    if (unjustified.length > 0) {
      const report = unjustified
        .map((f) => `  ${f.file}\n    prisma.${f.model}.${f.operation}(${f.snippet})`)
        .join('\n');
      throw new Error(
        `Found ${unjustified.length} query on a tenant-scoped model with no workspaceId filter.\n\n` +
          `${report}\n\n` +
          'Either add the workspace filter, or — if it is genuinely workspace-wide — add it to ' +
          'JUSTIFIED_SYSTEM_QUERIES with the reason it is safe.',
      );
    }

    expect(unjustified).toHaveLength(0);
  });

  it('keeps the justification list honest', () => {
    // An entry that no longer matches any real query is stale and hides regressions.
    const findings = scan();
    const stale = JUSTIFIED_SYSTEM_QUERIES.filter(
      (allowed) =>
        !findings.some(
          (finding) =>
            finding.file === allowed.file &&
            finding.model === allowed.model &&
            finding.operation === allowed.operation,
        ),
    );

    expect(
      stale.map((s) => `${s.file}: ${s.model}.${s.operation}`),
      'stale entries in JUSTIFIED_SYSTEM_QUERIES',
    ).toEqual([]);
  });

  it('every justification explains why it is safe', () => {
    for (const allowed of JUSTIFIED_SYSTEM_QUERIES) {
      expect(allowed.why.length, `${allowed.file}: ${allowed.model}.${allowed.operation}`).toBeGreaterThan(30);
    }
  });
});
