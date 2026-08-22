import { z } from 'zod';

/**
 * One predicate language, three consumers: flow Condition nodes, saved Segments,
 * and contact list filters. Divergence between them is a bug factory — a segment
 * that means one thing in a filter and another in a flow is impossible to debug.
 *
 * Deliberately NOT Turing-complete and NOT an expression language: an allow-listed
 * AST evaluated by a switch. Predicates are tenant input running on our servers.
 */

export const COMPARISON_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_set',
  'is_not_set',
  'in',
  'not_in',
  'before',
  'after',
  'within_days',
  'older_than_days',
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const FIELD_SOURCES = ['contact', 'tag', 'custom_field', 'conversation', 'variable'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

const primitiveValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const comparableValue = z.union([primitiveValue, z.array(primitiveValue)]);

export const conditionSchema = z.object({
  kind: z.literal('condition'),
  source: z.enum(FIELD_SOURCES),
  /** Contact system field name, tag id, custom field id, or variable path. */
  field: z.string().min(1).max(200),
  operator: z.enum(COMPARISON_OPERATORS),
  value: comparableValue.optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export type PredicateNode =
  | Condition
  | { kind: 'and'; children: PredicateNode[] }
  | { kind: 'or'; children: PredicateNode[] }
  | { kind: 'not'; child: PredicateNode }
  | { kind: 'always' };

export const predicateSchema: z.ZodType<PredicateNode> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({ kind: z.literal('and'), children: z.array(predicateSchema).max(50) }),
    z.object({ kind: z.literal('or'), children: z.array(predicateSchema).max(50) }),
    z.object({ kind: z.literal('not'), child: predicateSchema }),
    z.object({ kind: z.literal('always') }),
  ]),
);

/** Everything the evaluator is allowed to see. No I/O happens during evaluation. */
export interface PredicateSubject {
  contact: {
    id: string;
    status: string;
    primaryChannel: string;
    displayName: string | null;
    username: string | null;
    locale: string | null;
    source: string | null;
    consentState: string | null;
    firstSeenAt: Date | null;
    lastInteractionAt: Date | null;
    createdAt: Date | null;
  };
  /** Tag ids applied to the contact. */
  tagIds: Set<string>;
  /** Custom field values keyed by custom field id. */
  customFields: Map<string, unknown>;
  conversation?: {
    status: string;
    windowState: string;
    assigneeId: string | null;
    lastInboundAt: Date | null;
    unreadCount: number;
  };
  /** Execution variables, addressable by dotted path. */
  variables?: Record<string, unknown>;
  now: Date;
}

function readPath(source: Record<string, unknown> | undefined, path: string): unknown {
  if (!source) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function resolveOperand(node: Condition, subject: PredicateSubject): unknown {
  switch (node.source) {
    case 'contact':
      return (subject.contact as unknown as Record<string, unknown>)[node.field];
    case 'tag':
      // For tags the "value" is presence: the field is the tag id.
      return subject.tagIds.has(node.field);
    case 'custom_field':
      return subject.customFields.get(node.field);
    case 'conversation':
      return subject.conversation
        ? (subject.conversation as unknown as Record<string, unknown>)[node.field]
        : undefined;
    case 'variable':
      return readPath(subject.variables, node.field);
  }
}

function toComparableNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (value instanceof Date) return value.getTime();
  return undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

const DAY_MS = 86_400_000;

function evaluateCondition(node: Condition, subject: PredicateSubject): boolean {
  const actual = resolveOperand(node, subject);
  const expected = node.value;

  switch (node.operator) {
    case 'is_set':
      return actual !== undefined && actual !== null && actual !== '' && actual !== false;
    case 'is_not_set':
      return actual === undefined || actual === null || actual === '' || actual === false;

    case 'eq':
      if (typeof actual === 'boolean' || typeof expected === 'boolean') return actual === expected;
      return String(actual ?? '') === String(expected ?? '');
    case 'neq':
      if (typeof actual === 'boolean' || typeof expected === 'boolean') return actual !== expected;
      return String(actual ?? '') !== String(expected ?? '');

    case 'contains': {
      const a = asString(actual)?.toLowerCase();
      const b = asString(expected)?.toLowerCase();
      return a !== undefined && b !== undefined && a.includes(b);
    }
    case 'not_contains': {
      const a = asString(actual)?.toLowerCase();
      const b = asString(expected)?.toLowerCase();
      if (a === undefined || b === undefined) return true;
      return !a.includes(b);
    }
    case 'starts_with': {
      const a = asString(actual)?.toLowerCase();
      const b = asString(expected)?.toLowerCase();
      return a !== undefined && b !== undefined && a.startsWith(b);
    }
    case 'ends_with': {
      const a = asString(actual)?.toLowerCase();
      const b = asString(expected)?.toLowerCase();
      return a !== undefined && b !== undefined && a.endsWith(b);
    }

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toComparableNumber(actual);
      const b = toComparableNumber(expected);
      if (a === undefined || b === undefined) return false;
      if (node.operator === 'gt') return a > b;
      if (node.operator === 'gte') return a >= b;
      if (node.operator === 'lt') return a < b;
      return a <= b;
    }

    case 'in':
    case 'not_in': {
      const list = Array.isArray(expected) ? expected.map((v) => String(v ?? '')) : [];
      const hit = list.includes(String(actual ?? ''));
      return node.operator === 'in' ? hit : !hit;
    }

    case 'before':
    case 'after': {
      const a = toDate(actual);
      const b = toDate(expected);
      if (!a || !b) return false;
      return node.operator === 'before' ? a.getTime() < b.getTime() : a.getTime() > b.getTime();
    }

    case 'within_days':
    case 'older_than_days': {
      const a = toDate(actual);
      const days = toComparableNumber(expected);
      if (!a || days === undefined) return false;
      const age = subject.now.getTime() - a.getTime();
      return node.operator === 'within_days' ? age <= days * DAY_MS : age > days * DAY_MS;
    }
  }
}

export function evaluatePredicate(node: PredicateNode, subject: PredicateSubject): boolean {
  switch (node.kind) {
    case 'always':
      return true;
    case 'condition':
      return evaluateCondition(node, subject);
    case 'and':
      return node.children.every((child) => evaluatePredicate(child, subject));
    case 'or':
      return node.children.length === 0
        ? false
        : node.children.some((child) => evaluatePredicate(child, subject));
    case 'not':
      return !evaluatePredicate(node.child, subject);
  }
}

/** Collects the tag and custom-field ids a predicate references, for validation. */
export function collectPredicateReferences(node: PredicateNode): {
  tagIds: string[];
  customFieldIds: string[];
} {
  const tagIds: string[] = [];
  const customFieldIds: string[] = [];

  const walk = (n: PredicateNode): void => {
    switch (n.kind) {
      case 'condition':
        if (n.source === 'tag') tagIds.push(n.field);
        if (n.source === 'custom_field') customFieldIds.push(n.field);
        return;
      case 'and':
      case 'or':
        n.children.forEach(walk);
        return;
      case 'not':
        walk(n.child);
        return;
      case 'always':
        return;
    }
  };

  walk(node);
  return { tagIds: [...new Set(tagIds)], customFieldIds: [...new Set(customFieldIds)] };
}
