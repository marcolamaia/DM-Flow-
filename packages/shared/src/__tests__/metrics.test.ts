import { describe, expect, it } from 'vitest';
import {
  AT_RISK_STATUSES,
  METRIC_DEFINITIONS,
  METRIC_IDS,
  MIN_SAMPLE_FOR_RATE,
  MRR_STATUSES,
  addMoney,
  dayKey,
  dayRange,
  lifetimeValueCents,
  monthKey,
  monthlyCents,
  rate,
  startOfPeriod,
} from '../metrics.js';

describe('turning a price into a monthly figure', () => {
  it('leaves a monthly price alone and divides a yearly one', () => {
    expect(monthlyCents(9900, 'month')).toBe(9900);
    expect(monthlyCents(118_800, 'year')).toBe(9900);
  });

  it('refuses an interval it does not know rather than guessing', () => {
    // Treating an unknown interval as monthly would inflate MRR twelvefold the
    // first time somebody added an annual plan with a typo in the interval.
    expect(() => monthlyCents(9900, 'quarter')).toThrow(/unknown billing interval/);
  });

  it('normalises weekly and daily onto the same scale', () => {
    expect(monthlyCents(1000, 'week')).toBe(4333);
    expect(monthlyCents(100, 'day')).toBe(3042);
  });
});

describe('money never crosses currencies', () => {
  it('keeps each currency in its own total', () => {
    const total = {};
    addMoney(total, 'BRL', 9900);
    addMoney(total, 'USD', 4900);
    addMoney(total, 'BRL', 100);

    expect(total).toEqual({ BRL: 10_000, USD: 4900 });
  });
});

describe('rates carry the sample they came from', () => {
  it('marks a rate from too few accounts as unreliable', () => {
    const small = rate(3, 5);
    expect(small.value).toBe(0.6);
    // Three cancellations out of five accounts is five accounts, not 60% churn.
    expect(small.reliable).toBe(false);

    expect(rate(3, MIN_SAMPLE_FOR_RATE).reliable).toBe(true);
  });

  it('returns nothing rather than dividing by zero', () => {
    expect(rate(0, 0).value).toBeNull();
  });

  it('judges a money ratio by the accounts behind it, not by the amounts', () => {
    // Revenue churn divides cents by cents. R$ 741 of recurring revenue from
    // three accounts clears any threshold counted in cents, and would present a
    // three-account figure as solid — which is what this argument prevents.
    const fromThreeAccounts = rate(0, 74_100, 3);
    expect(fromThreeAccounts.reliable).toBe(false);
    expect(fromThreeAccounts.sampleSize).toBe(3);

    // Without the sample it would read as reliable purely because cents are big.
    expect(rate(0, 74_100).reliable).toBe(true);
  });
});

describe('lifetime value', () => {
  it('is not reported when there is no churn to divide by', () => {
    // At zero churn LTV is infinite; a very large number with two decimal places
    // would be an answer the data cannot support.
    expect(lifetimeValueCents(9900, rate(0, 100))).toBeNull();
  });

  it('is not reported from an unreliable churn rate', () => {
    expect(lifetimeValueCents(9900, rate(1, 4))).toBeNull();
  });

  it('divides revenue per account by monthly churn when both are sound', () => {
    expect(lifetimeValueCents(10_000, rate(5, 100))).toBe(200_000);
  });
});

describe('the reporting calendar', () => {
  it('buckets an instant by the reporting timezone, not the server', () => {
    // 02:30 UTC is still the previous evening in São Paulo. Bucketing by UTC
    // would move that event into the wrong day.
    expect(dayKey(new Date('2026-03-15T02:30:00Z'), 'America/Sao_Paulo')).toBe('2026-03-14');
    expect(monthKey(new Date('2026-04-01T02:30:00Z'), 'America/Sao_Paulo')).toBe('2026-03');
  });

  it('finds local midnight on both sides of a clock change', () => {
    expect(startOfPeriod('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfPeriod('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });

  it('walks a range across a clock change without skipping or repeating a day', () => {
    const days = dayRange(
      new Date('2026-03-06T12:00:00Z'),
      new Date('2026-03-11T12:00:00Z'),
      'America/New_York',
    );

    expect(days).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);
    expect(new Set(days).size).toBe(days.length);
  });

  it('returns a single day for a range inside one day', () => {
    const days = dayRange(new Date('2026-03-06T01:00:00Z'), new Date('2026-03-06T02:00:00Z'), 'UTC');
    expect(days).toEqual(['2026-03-06']);
  });
});

describe('what counts as revenue', () => {
  it('leaves trials out of MRR and past due out of both', () => {
    expect(MRR_STATUSES).toEqual(['ACTIVE']);
    expect(MRR_STATUSES as readonly string[]).not.toContain('TRIALING');
    // Past due is reported separately, where it is a warning, rather than mixed
    // into the headline where it hides one.
    expect(AT_RISK_STATUSES as readonly string[]).toContain('PAST_DUE');
    expect(MRR_STATUSES as readonly string[]).not.toContain('PAST_DUE');
  });
});

describe('the metric catalogue', () => {
  it('defines every metric it lists, and lists every metric it defines', () => {
    expect(Object.keys(METRIC_DEFINITIONS).sort()).toEqual([...METRIC_IDS].sort());
  });

  it('explains every figure in both languages', () => {
    // A number the panel cannot explain is a number it should not show.
    for (const definition of Object.values(METRIC_DEFINITIONS)) {
      expect(definition.formula['pt-BR'].length, definition.id).toBeGreaterThan(20);
      expect(definition.formula.en.length, definition.id).toBeGreaterThan(20);
      expect(definition.label['pt-BR'].length, definition.id).toBeGreaterThan(0);
    }
  });

  it('says out loud what MRR leaves out', () => {
    const mrr = METRIC_DEFINITIONS.mrr;
    expect(mrr.excludes).toBeDefined();
    expect(mrr.excludes!['pt-BR']).toMatch(/teste/i);
  });
});
