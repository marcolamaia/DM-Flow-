export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    locale: string;
    avatarUrl: string | null;
    totpEnabled: boolean;
    emailVerified: boolean;
  };
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'AGENT' | 'VIEWER';
    status: string;
    suspensionReason: string | null;
    plan: string;
  }>;
}

export interface UsageSnapshot {
  contacts: { used: number; limit: number | null };
  automations: { used: number; limit: number | null };
  publishedAutomations: { used: number; limit: number | null };
  connectedAccounts: { used: number; limit: number | null };
  members: { used: number; limit: number | null };
  messagesPerMonth: { used: number; limit: number | null };
  executionsPerMonth: { used: number; limit: number | null };
  period: string;
}

export interface ConnectedAccount {
  id: string;
  channel: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  accountType: string | null;
  status: string;
  statusDetail: string | null;
  isSandbox: boolean;
  grantedScopes: string[];
  tokenExpiresInDays: number | null;
  lastHealthCheckAt: string | null;
  connectedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  contactCount?: number;
}

export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: string;
  options: unknown;
}

export interface Contact {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  primaryChannel: string;
  status: string;
  source: string | null;
  lastInteractionAt: string | null;
  createdAt: string;
  tags: Array<{ id: string; name: string; color: string }>;
  customFields: Array<{ id: string; key: string; label: string; type: string; value: unknown }>;
  conversations: Array<{ id: string; status: string; windowState: string; channel: string }>;
}

export interface AutomationSummary {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
  hasUnpublishedChanges: boolean;
  triggerTypes: string[];
  executionCount: number;
  updatedAt: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  nodeId?: string;
  message: { 'pt-BR': string; en: string };
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  checkedAt: string;
}

export interface CapabilityEntry {
  id: string;
  channel: string;
  status: string;
  available: boolean;
  label: { 'pt-BR': string; en: string };
  limitations: { 'pt-BR': string; en: string };
  windowRequirement: string;
  idempotency: string;
  documentedLimits: Record<string, number | string | null>;
  doc: { url: string; validatedAt: string | null; apiVersion: string | null };
  pendingQuestion?: string;
}

export interface TriggerDefinitionDto {
  type: string;
  channel: string | null;
  label: { 'pt-BR': string; en: string };
  description: { 'pt-BR': string; en: string };
  limitations: { 'pt-BR': string; en: string };
  requiredCapabilities: string[];
  available: boolean;
  missingCapabilities: string[];
  isCatchAll: boolean;
}

export interface ConversationSummary {
  id: string;
  status: string;
  channel: string;
  unreadCount: number;
  windowState: string;
  windowExpiresAt: string | null;
  automationPaused: boolean;
  lastInboundAt: string | null;
  contact: {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
    tags: Array<{ id: string; name: string; color: string }>;
  };
  assignee: { id: string; name: string } | null;
  lastMessage: { direction: string; senderType: string; content: Record<string, unknown> } | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  features: string[];
  limits: Record<string, number | null>;
}

// ── Administrative panel ─────────────────────────────────────

export interface AdminMe {
  role: string;
  permissions: string[];
}

export type MoneyByCurrency = Record<string, number>;

export interface MetricDefinition {
  id: string;
  label: { 'pt-BR': string; en: string };
  unit: 'money' | 'count' | 'ratio';
  formula: { 'pt-BR': string; en: string };
  source: string;
  excludes?: { 'pt-BR': string; en: string };
}

export interface RevenueSnapshot {
  mrr: MoneyByCurrency;
  arr: MoneyByCurrency;
  atRisk: MoneyByCurrency;
  arpa: MoneyByCurrency;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  payingSubscriptions: number;
  asOf: string;
}

export interface MetricRate {
  value: number | null;
  numerator: number;
  denominator: number;
  sampleSize: number;
  reliable: boolean;
}

export interface GrowthReport {
  period: { from: string; to: string; timeZone: string };
  signups: number;
  activatedWorkspaces: number;
  newSubscriptions: number;
  churnedSubscriptions: number;
  logoChurn: MetricRate;
  revenueChurn: MetricRate;
  netRevenue: MoneyByCurrency;
  ltv: MoneyByCurrency;
  openingMrr: MoneyByCurrency;
}

export interface AdminOverview {
  revenue: RevenueSnapshot;
  growth: GrowthReport;
  definitions: MetricDefinition[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  piiMasked: boolean;
  locale: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  suspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  workspaceCount: number;
}

export interface AdminUserDetail extends AdminUserRow {
  twoFactorEnabled: boolean;
  suspensionReason: string | null;
  activeSessions: number;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    role: string;
    joinedAt: string;
    createdAt: string;
    subscription: {
      status: string;
      plan: string;
      currency: string;
      monthlyCents: number;
      currentPeriodEnd: string | null;
    } | null;
    usage: { contacts: number; automations: number; connectedAccounts: number };
  }>;
  recentEvents: Array<{ event: string; occurredAt: string; properties: Record<string, unknown> }>;
}

export interface AdminSubscriptionRow {
  id: string;
  status: string;
  workspace: { id: string; name: string; status: string; createdAt: string };
  owner: { id: string; email: string | null; name: string | null } | null;
  plan: { code: string; name: string };
  currency: string;
  monthlyCents: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  lastPaymentError: string | null;
  billingLinked: boolean;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  workspaceId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}
