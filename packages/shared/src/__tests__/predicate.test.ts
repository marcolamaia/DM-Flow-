import { describe, expect, it } from 'vitest';
import { evaluatePredicate, predicateSchema, collectPredicateReferences } from '../predicate';
import type { PredicateSubject } from '../predicate';

function subject(overrides: Partial<PredicateSubject> = {}): PredicateSubject {
  return {
    contact: {
      id: 'c1',
      status: 'ACTIVE',
      primaryChannel: 'INSTAGRAM',
      displayName: 'Ana Souza',
      username: 'ana_s',
      locale: 'pt-BR',
      source: 'ig_comment',
      consentState: null,
      firstSeenAt: new Date('2026-08-01T00:00:00Z'),
      lastInteractionAt: new Date('2026-08-21T00:00:00Z'),
      createdAt: new Date('2026-08-01T00:00:00Z'),
    },
    tagIds: new Set(['tag-lead']),
    customFields: new Map<string, unknown>([['cf-score', 90], ['cf-note', 'vip']]),
    now: new Date('2026-08-22T00:00:00Z'),
    ...overrides,
  };
}

describe('predicate evaluator', () => {
  it('matches tag presence and absence', () => {
    expect(
      evaluatePredicate({ kind: 'condition', source: 'tag', field: 'tag-lead', operator: 'is_set' }, subject()),
    ).toBe(true);
    expect(
      evaluatePredicate({ kind: 'condition', source: 'tag', field: 'tag-x', operator: 'is_set' }, subject()),
    ).toBe(false);
    expect(
      evaluatePredicate({ kind: 'condition', source: 'tag', field: 'tag-x', operator: 'is_not_set' }, subject()),
    ).toBe(true);
  });

  it('compares custom field numbers numerically, not as text', () => {
    // The trap: "90" < "9" lexically. A score field must not behave that way.
    expect(
      evaluatePredicate(
        { kind: 'condition', source: 'custom_field', field: 'cf-score', operator: 'gt', value: 9 },
        subject(),
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { kind: 'condition', source: 'custom_field', field: 'cf-score', operator: 'lt', value: 100 },
        subject(),
      ),
    ).toBe(true);
  });

  it('treats a missing operand as not matching rather than throwing', () => {
    expect(
      evaluatePredicate(
        { kind: 'condition', source: 'custom_field', field: 'nope', operator: 'gt', value: 1 },
        subject(),
      ),
    ).toBe(false);
  });

  it('handles and / or / not', () => {
    const s = subject();
    expect(
      evaluatePredicate(
        {
          kind: 'and',
          children: [
            { kind: 'condition', source: 'contact', field: 'status', operator: 'eq', value: 'ACTIVE' },
            { kind: 'not', child: { kind: 'condition', source: 'tag', field: 'tag-x', operator: 'is_set' } },
          ],
        },
        s,
      ),
    ).toBe(true);

    // An empty OR is false and an empty AND is true, matching set semantics.
    expect(evaluatePredicate({ kind: 'or', children: [] }, s)).toBe(false);
    expect(evaluatePredicate({ kind: 'and', children: [] }, s)).toBe(true);
  });

  it('evaluates relative date operators against the supplied clock', () => {
    const s = subject();
    expect(
      evaluatePredicate(
        { kind: 'condition', source: 'contact', field: 'lastInteractionAt', operator: 'within_days', value: 2 },
        s,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { kind: 'condition', source: 'contact', field: 'lastInteractionAt', operator: 'older_than_days', value: 5 },
        s,
      ),
    ).toBe(false);
  });

  it('rejects a malformed predicate at the schema boundary', () => {
    expect(() =>
      predicateSchema.parse({ kind: 'condition', source: 'nope', field: 'x', operator: 'eq' }),
    ).toThrow();
  });

  it('collects referenced tag and field ids for validation', () => {
    const refs = collectPredicateReferences({
      kind: 'or',
      children: [
        { kind: 'condition', source: 'tag', field: 'tag-a', operator: 'is_set' },
        { kind: 'not', child: { kind: 'condition', source: 'custom_field', field: 'cf-1', operator: 'is_set' } },
      ],
    });
    expect(refs.tagIds).toEqual(['tag-a']);
    expect(refs.customFieldIds).toEqual(['cf-1']);
  });
});
