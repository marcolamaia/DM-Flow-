/**
 * The definitions behind every number the admin panel shows.
 *
 * The rule this file exists to enforce: MRR on the dashboard and MRR in a
 * report are the same number, because they are the same calculation. Not two
 * queries that agree today and drift the first time somebody adds a plan
 * interval or decides trials should count.
 *
 * So the decisions live here — which subscription statuses are revenue, how a
 * yearly price becomes a monthly one, when a rate has too little data to mean
 * anything — and both the aggregation code and the interface read them from
 * here. A number the panel cannot explain is a number it should not show.
 */
import type { LocalizedMessage } from './locale.js';

/** Money, always in the smallest unit, always with its currency attached. */
export interface Money {
  currency: string;
  cents: number;
}

/**
 * Currencies are never summed together.
 *
 * There is no honest way to add R$ 100 to US$ 100 without a rate, and inventing
 * one would make the total a number nobody can defend. Totals are reported per
 * currency; the interface shows them side by side.
 */
export type MoneyByCurrency = Record<string, number>;

export function addMoney(into: MoneyByCurrency, currency: string, cents: number): MoneyByCurrency {
  into[currency] = (into[currency] ?? 0) + cents;
  return into;
}

/** Billing intervals we know how to turn into a monthly figure. */
export const BILLING_INTERVALS = ['day', 'week', 'month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * A price on any interval, expressed as what it is worth per month.
 *
 * Yearly divided by twelve, weekly multiplied out over the average month. Not
 * exact for any individual month — no normalisation is — but it is one rule
 * applied everywhere, which is the property that matters.
 */
export function monthlyCents(priceCents: number, interval: string): number {
  switch (interval) {
    case 'month':
      return Math.round(priceCents);
    case 'year':
      return Math.round(priceCents / 12);
    case 'week':
      return Math.round((priceCents * 52) / 12);
    case 'day':
      return Math.round((priceCents * 365) / 12);
    default:
      // Silently treating an unknown interval as monthly would quietly inflate
      // MRR by 12x the first time somebody adds an annual plan with a typo.
      throw new Error(`unknown billing interval: ${interval}`);
  }
}

/**
 * Which subscriptions are counted as recurring revenue.
 *
 * ACTIVE only. A trial has not paid, so counting it makes MRR a forecast
 * wearing the clothes of a fact. Past due has paid before but is not paying
 * now — it is reported separately as revenue at risk, where it is useful,
 * rather than mixed into the headline where it hides a problem.
 */
export const MRR_STATUSES = ['ACTIVE'] as const;
export const AT_RISK_STATUSES = ['PAST_DUE', 'UNPAID'] as const;
export const NOT_REVENUE_STATUSES = [
  'TRIALING',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'PAUSED',
] as const;

/**
 * Below this many accounts, a rate is noise.
 *
 * Three cancellations out of five accounts is not 60% churn, it is five
 * accounts. Showing it as a percentage invites a decision the data cannot
 * support, so rates carry the sample they came from and say when it is too
 * small to read.
 */
export const MIN_SAMPLE_FOR_RATE = 20;

export interface Rate {
  /** The ratio itself, or null when the denominator is zero. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** How many accounts the ratio is based on — never an amount of money. */
  sampleSize: number;
  /** False when the sample is below MIN_SAMPLE_FOR_RATE. */
  reliable: boolean;
}

/**
 * A ratio that carries how much it can be trusted.
 *
 * `sampleSize` is separate from the denominator on purpose. Revenue churn
 * divides money by money, and cents clear any sample threshold instantly — so
 * a rate computed from three accounts would present itself as solid. The number
 * of accounts is what decides, whatever the ratio happens to be made of.
 */
export function rate(numerator: number, denominator: number, sampleSize = denominator): Rate {
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    sampleSize,
    reliable: sampleSize >= MIN_SAMPLE_FOR_RATE,
  };
}

/**
 * Lifetime value, or nothing.
 *
 * LTV is ARPA divided by the churn rate, which means at zero churn it is
 * infinite. The honest answer there is "not yet knowable", not a very large
 * number presented with two decimal places.
 */
export function lifetimeValueCents(arpaCents: number, churn: Rate): number | null {
  if (churn.value === null || churn.value <= 0) return null;
  if (!churn.reliable) return null;
  return Math.round(arpaCents / churn.value);
}

// ---------------------------------------------------------------------------
// Reporting calendar
// ---------------------------------------------------------------------------

/**
 * The timezone every figure is bucketed in.
 *
 * Without one fixed zone, "revenue today" means something different depending
 * on where the server happens to run, and two people comparing numbers are
 * comparing different days. The platform picks one and states it next to
 * every chart.
 */
export const DEFAULT_REPORTING_TIMEZONE = 'America/Sao_Paulo';

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asIfUtc - instant.getTime();
}

/** The calendar day an instant falls on, in the reporting timezone: `2026-03-14`. */
export function dayKey(instant: Date, timeZone: string = DEFAULT_REPORTING_TIMEZONE): string {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return shifted.toISOString().slice(0, 10);
}

/** The calendar month an instant falls on, in the reporting timezone: `2026-03`. */
export function monthKey(instant: Date, timeZone: string = DEFAULT_REPORTING_TIMEZONE): string {
  return dayKey(instant, timeZone).slice(0, 7);
}

/**
 * The instant local midnight begins, for a `YYYY-MM-DD` or `YYYY-MM` key.
 *
 * Two passes because the offset depends on the instant we are trying to find:
 * the first guess lands in the right neighbourhood, the second corrects it
 * across a daylight-saving boundary.
 */
export function startOfPeriod(key: string, timeZone: string = DEFAULT_REPORTING_TIMEZONE): Date {
  const [year, month, day] = `${key}-01`.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  const second = guess - zoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** Every day key from `from` to `to` inclusive, so a chart has no silent gaps. */
export function dayRange(from: Date, to: Date, timeZone = DEFAULT_REPORTING_TIMEZONE): string[] {
  const days: string[] = [];
  let cursor = startOfPeriod(dayKey(from, timeZone), timeZone);
  const last = dayKey(to, timeZone);

  // A day at a time via noon, which no daylight-saving shift lands on.
  while (days.length < 3660) {
    const key = dayKey(cursor, timeZone);
    days.push(key);
    if (key >= last) break;
    cursor = startOfPeriod(dayKey(new Date(cursor.getTime() + 36 * 3600_000), timeZone), timeZone);
  }
  return days;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const METRIC_IDS = [
  'mrr',
  'arr',
  'mrr_at_risk',
  'arpa',
  'active_subscriptions',
  'trialing_subscriptions',
  'new_subscriptions',
  'churned_subscriptions',
  'logo_churn',
  'revenue_churn',
  'ltv',
  'signups',
  'activated_workspaces',
  'net_revenue',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type MetricUnit = 'money' | 'count' | 'ratio';

export interface MetricDefinition {
  id: MetricId;
  label: LocalizedMessage;
  unit: MetricUnit;
  /** How it is calculated, in words a person can check the code against. */
  formula: LocalizedMessage;
  /** What it is read from. */
  source: 'subscriptions' | 'events' | 'workspaces';
  /** What is deliberately left out, and why. Shown next to the number. */
  excludes?: LocalizedMessage;
}

/**
 * Every metric the panel is allowed to show.
 *
 * A screen that wants a number not in this list does not get to invent one; it
 * gets a definition added here first, reviewed once, and then used everywhere.
 */
export const METRIC_DEFINITIONS: Record<MetricId, MetricDefinition> = {
  mrr: {
    id: 'mrr',
    label: { 'pt-BR': 'Receita recorrente mensal (MRR)', en: 'Monthly recurring revenue (MRR)' },
    unit: 'money',
    source: 'subscriptions',
    formula: {
      'pt-BR':
        'Soma do preço mensal de todas as assinaturas ativas. Preço anual é dividido por 12. Somado por moeda, nunca entre moedas.',
      en: 'Sum of the monthly price of every active subscription. Annual prices divided by 12. Totalled per currency, never across currencies.',
    },
    excludes: {
      'pt-BR': 'Não inclui testes gratuitos, assinaturas em atraso, planos gratuitos nem cobranças avulsas.',
      en: 'Excludes trials, past-due subscriptions, free plans and one-off charges.',
    },
  },
  arr: {
    id: 'arr',
    label: { 'pt-BR': 'Receita recorrente anual (ARR)', en: 'Annual recurring revenue (ARR)' },
    unit: 'money',
    source: 'subscriptions',
    formula: {
      'pt-BR': 'MRR × 12. É uma projeção do momento atual, não o que foi faturado no ano.',
      en: 'MRR × 12. A projection from the current moment, not what was billed over the year.',
    },
  },
  mrr_at_risk: {
    id: 'mrr_at_risk',
    label: { 'pt-BR': 'Receita em risco', en: 'Revenue at risk' },
    unit: 'money',
    source: 'subscriptions',
    formula: {
      'pt-BR':
        'Preço mensal das assinaturas com pagamento em atraso. Fica fora do MRR justamente para não esconder o problema dentro dele.',
      en: 'Monthly price of past-due subscriptions. Kept out of MRR precisely so the problem is not hidden inside it.',
    },
  },
  arpa: {
    id: 'arpa',
    label: { 'pt-BR': 'Receita média por conta', en: 'Average revenue per account' },
    unit: 'money',
    source: 'subscriptions',
    formula: {
      'pt-BR': 'MRR dividido pelo número de assinaturas ativas pagantes.',
      en: 'MRR divided by the number of active paying subscriptions.',
    },
  },
  active_subscriptions: {
    id: 'active_subscriptions',
    label: { 'pt-BR': 'Assinaturas ativas', en: 'Active subscriptions' },
    unit: 'count',
    source: 'subscriptions',
    formula: {
      'pt-BR': 'Assinaturas com status ativo neste momento.',
      en: 'Subscriptions currently in an active state.',
    },
  },
  trialing_subscriptions: {
    id: 'trialing_subscriptions',
    label: { 'pt-BR': 'Em período de teste', en: 'In trial' },
    unit: 'count',
    source: 'subscriptions',
    formula: {
      'pt-BR': 'Assinaturas em teste. Contadas separadamente porque ainda não são receita.',
      en: 'Subscriptions in trial. Counted separately because they are not revenue yet.',
    },
  },
  new_subscriptions: {
    id: 'new_subscriptions',
    label: { 'pt-BR': 'Novas assinaturas', en: 'New subscriptions' },
    unit: 'count',
    source: 'events',
    formula: {
      'pt-BR': 'Eventos de início e reativação de assinatura dentro do período.',
      en: 'Subscription start and reactivation events within the period.',
    },
  },
  churned_subscriptions: {
    id: 'churned_subscriptions',
    label: { 'pt-BR': 'Cancelamentos', en: 'Cancellations' },
    unit: 'count',
    source: 'events',
    formula: {
      'pt-BR': 'Eventos de cancelamento dentro do período.',
      en: 'Cancellation events within the period.',
    },
  },
  logo_churn: {
    id: 'logo_churn',
    label: { 'pt-BR': 'Cancelamento de contas', en: 'Logo churn' },
    unit: 'ratio',
    source: 'events',
    formula: {
      'pt-BR':
        'Cancelamentos no período ÷ assinaturas ativas no início do período. Abaixo de 20 contas o número vem marcado como pouco confiável.',
      en: 'Cancellations in the period ÷ subscriptions active at the start of it. Below 20 accounts the figure is marked unreliable.',
    },
  },
  revenue_churn: {
    id: 'revenue_churn',
    label: { 'pt-BR': 'Cancelamento de receita', en: 'Revenue churn' },
    unit: 'ratio',
    source: 'events',
    formula: {
      'pt-BR':
        'MRR perdido em cancelamentos ÷ MRR no início do período. Usa o valor gravado no evento, ou seja, quanto a assinatura valia quando foi cancelada.',
      en: 'MRR lost to cancellations ÷ MRR at the start of the period. Uses the amount recorded on the event: what the subscription was worth when it was cancelled.',
    },
  },
  ltv: {
    id: 'ltv',
    label: { 'pt-BR': 'Valor por cliente (LTV)', en: 'Lifetime value (LTV)' },
    unit: 'money',
    source: 'events',
    formula: {
      'pt-BR':
        'Receita média por conta ÷ taxa de cancelamento mensal. Sem cancelamentos, ou com amostra pequena demais, o valor não é exibido.',
      en: 'Average revenue per account ÷ monthly churn rate. With no cancellations, or too small a sample, no figure is shown.',
    },
  },
  signups: {
    id: 'signups',
    label: { 'pt-BR': 'Cadastros', en: 'Signups' },
    unit: 'count',
    source: 'events',
    formula: {
      'pt-BR': 'Eventos de cadastro dentro do período, no fuso do relatório.',
      en: 'Registration events within the period, in the reporting timezone.',
    },
  },
  activated_workspaces: {
    id: 'activated_workspaces',
    label: { 'pt-BR': 'Contas ativadas', en: 'Activated accounts' },
    unit: 'count',
    source: 'events',
    formula: {
      'pt-BR':
        'Contas que publicaram ao menos uma automação. Publicar é o primeiro momento em que a plataforma faz algo por quem se cadastrou.',
      en: 'Accounts that published at least one automation — the first point at which the platform does something for the person who signed up.',
    },
  },
  net_revenue: {
    id: 'net_revenue',
    label: { 'pt-BR': 'Receita líquida do período', en: 'Net revenue for the period' },
    unit: 'money',
    source: 'events',
    formula: {
      'pt-BR':
        'Pagamentos confirmados menos reembolsos e chargebacks, pelo valor gravado em cada evento. É caixa do período, não MRR.',
      en: 'Successful payments less refunds and chargebacks, at the amount recorded on each event. Cash for the period, not MRR.',
    },
  },
};
