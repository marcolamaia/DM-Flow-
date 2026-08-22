/**
 * Plan limits. `null` means unlimited. Quotas are enforced server-side at the
 * point of creation, never only in the UI.
 */
export interface PlanLimits {
  /** Max contacts stored in the workspace. */
  contacts: number | null;
  /** Max automations that can exist (any status). */
  automations: number | null;
  /** Max published automations running at once. */
  publishedAutomations: number | null;
  /** Max connected channel accounts. */
  connectedAccounts: number | null;
  /** Max workspace members. */
  members: number | null;
  /** Outbound messages per calendar month. */
  messagesPerMonth: number | null;
  /** Executions started per calendar month. */
  executionsPerMonth: number | null;
  /** Days of execution-step history retained. */
  historyRetentionDays: number;
}

export type PlanFeature =
  | 'inbox'
  | 'analytics'
  | 'segments'
  | 'templates'
  | 'http_request_node'
  | 'outbound_webhooks'
  | 'public_api'
  | 'team_roles'
  | 'audit_log'
  | 'priority_support';

export interface PlanDefinition {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: 'month';
  limits: PlanLimits;
  features: PlanFeature[];
  sortOrder: number;
  isPublic: boolean;
}

/**
 * Free is deliberately usable, not a demo: the whole loop works, just small.
 * A free workspace that cannot complete one real automation teaches nothing.
 */
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    code: 'free',
    name: 'Free',
    description: 'Para testar o loop completo em uma conta, com volume pequeno.',
    priceCents: 0,
    currency: 'BRL',
    interval: 'month',
    limits: {
      contacts: 250,
      automations: 2,
      publishedAutomations: 1,
      connectedAccounts: 1,
      members: 1,
      messagesPerMonth: 500,
      executionsPerMonth: 500,
      historyRetentionDays: 7,
    },
    features: ['inbox', 'analytics'],
    sortOrder: 0,
    isPublic: true,
  },
  {
    code: 'starter',
    name: 'Starter',
    description: 'Para criadores que já convertem DM em venda.',
    priceCents: 9700,
    currency: 'BRL',
    interval: 'month',
    limits: {
      contacts: 5_000,
      automations: 15,
      publishedAutomations: 10,
      connectedAccounts: 2,
      members: 3,
      messagesPerMonth: 15_000,
      executionsPerMonth: 20_000,
      historyRetentionDays: 30,
    },
    features: ['inbox', 'analytics', 'segments', 'templates', 'http_request_node', 'team_roles'],
    sortOrder: 1,
    isPublic: true,
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'Para operações com time no inbox e vários fluxos rodando.',
    priceCents: 24700,
    currency: 'BRL',
    interval: 'month',
    limits: {
      contacts: 30_000,
      automations: null,
      publishedAutomations: null,
      connectedAccounts: 5,
      members: 10,
      messagesPerMonth: 100_000,
      executionsPerMonth: 150_000,
      historyRetentionDays: 90,
    },
    features: [
      'inbox',
      'analytics',
      'segments',
      'templates',
      'http_request_node',
      'outbound_webhooks',
      'public_api',
      'team_roles',
      'audit_log',
    ],
    sortOrder: 2,
    isPublic: true,
  },
  {
    code: 'business',
    name: 'Business',
    description: 'Para agências e operações que gerenciam várias contas.',
    priceCents: 59700,
    currency: 'BRL',
    interval: 'month',
    limits: {
      contacts: null,
      automations: null,
      publishedAutomations: null,
      connectedAccounts: 25,
      members: 50,
      messagesPerMonth: null,
      executionsPerMonth: null,
      historyRetentionDays: 365,
    },
    features: [
      'inbox',
      'analytics',
      'segments',
      'templates',
      'http_request_node',
      'outbound_webhooks',
      'public_api',
      'team_roles',
      'audit_log',
      'priority_support',
    ],
    sortOrder: 3,
    isPublic: true,
  },
];

export const FREE_PLAN_CODE = 'free';

export function getPlanDefinition(code: string): PlanDefinition | undefined {
  return PLAN_DEFINITIONS.find((p) => p.code === code);
}

/** Metrics tracked in UsageCounter, keyed by calendar month. */
export const USAGE_METRICS = ['messages_sent', 'executions_started'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export function currentUsagePeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface QuotaCheck {
  metric: string;
  limit: number | null;
  current: number;
  allowed: boolean;
  remaining: number | null;
}

export function checkQuota(limit: number | null, current: number, increment = 1): QuotaCheck {
  if (limit === null) {
    return { metric: '', limit: null, current, allowed: true, remaining: null };
  }
  const allowed = current + increment <= limit;
  return { metric: '', limit, current, allowed, remaining: Math.max(0, limit - current) };
}
