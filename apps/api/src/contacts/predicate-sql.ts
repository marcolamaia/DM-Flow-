import { DmFlowError, type Condition, type PredicateNode } from '@dmflow/shared';

/**
 * Translates a predicate AST into a parameterised SQL fragment over "Contact" c.
 *
 * Evaluating predicates in memory would mean loading every contact to filter a
 * segment, which stops working at the first customer with real volume. So the same
 * AST that the engine evaluates per-contact is compiled to SQL for list queries.
 *
 * Every user-supplied value becomes a bound parameter. Only column names are
 * interpolated, and only from a fixed allow-list — a field name that is not on the
 * list is rejected rather than escaped.
 */

const CONTACT_COLUMNS: Record<string, { column: string; type: 'text' | 'timestamp' }> = {
  status: { column: 'status', type: 'text' },
  primaryChannel: { column: '"primaryChannel"', type: 'text' },
  displayName: { column: '"displayName"', type: 'text' },
  username: { column: 'username', type: 'text' },
  locale: { column: 'locale', type: 'text' },
  source: { column: 'source', type: 'text' },
  consentState: { column: '"consentState"', type: 'text' },
  firstSeenAt: { column: '"firstSeenAt"', type: 'timestamp' },
  lastInteractionAt: { column: '"lastInteractionAt"', type: 'timestamp' },
  createdAt: { column: '"createdAt"', type: 'timestamp' },
};

const CONVERSATION_COLUMNS: Record<string, { column: string; type: 'text' | 'timestamp' | 'int' }> =
  {
    status: { column: 'status', type: 'text' },
    windowState: { column: '"windowState"', type: 'text' },
    assigneeId: { column: '"assigneeId"', type: 'text' },
    lastInboundAt: { column: '"lastInboundAt"', type: 'timestamp' },
    unreadCount: { column: '"unreadCount"', type: 'int' },
  };

export interface CompiledPredicate {
  sql: string;
  params: unknown[];
}

class Compiler {
  private readonly params: unknown[] = [];

  private bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  compile(node: PredicateNode): CompiledPredicate {
    const sql = this.walk(node);
    return { sql, params: this.params };
  }

  private walk(node: PredicateNode): string {
    switch (node.kind) {
      case 'always':
        return 'TRUE';
      case 'and':
        if (node.children.length === 0) return 'TRUE';
        return `(${node.children.map((c) => this.walk(c)).join(' AND ')})`;
      case 'or':
        if (node.children.length === 0) return 'FALSE';
        return `(${node.children.map((c) => this.walk(c)).join(' OR ')})`;
      case 'not':
        return `(NOT ${this.walk(node.child)})`;
      case 'condition':
        return this.condition(node);
    }
  }

  private condition(node: Condition): string {
    switch (node.source) {
      case 'tag':
        return this.tagCondition(node);
      case 'custom_field':
        return this.customFieldCondition(node);
      case 'contact':
        return this.columnCondition(node, CONTACT_COLUMNS, 'c.');
      case 'conversation':
        return this.conversationCondition(node);
      case 'variable':
        // Execution variables exist only inside a running flow, never in a list query.
        throw new DmFlowError('VALIDATION_FAILED', {
          details: [{ path: 'source', message: 'variable conditions cannot be used in filters' }],
        });
    }
  }

  private tagCondition(node: Condition): string {
    const exists = `EXISTS (SELECT 1 FROM "ContactTag" ct WHERE ct."contactId" = c.id AND ct."tagId" = ${this.bind(node.field)})`;
    return node.operator === 'is_not_set' ? `(NOT ${exists})` : exists;
  }

  private customFieldCondition(node: Condition): string {
    const fieldParam = this.bind(node.field);
    const base = `SELECT 1 FROM "CustomFieldValue" cv WHERE cv."contactId" = c.id AND cv."customFieldId" = ${fieldParam}`;

    if (node.operator === 'is_set') {
      return `EXISTS (${base} AND cv.value IS NOT NULL AND cv.value::text NOT IN ('null','""'))`;
    }
    if (node.operator === 'is_not_set') {
      return `(NOT EXISTS (${base} AND cv.value IS NOT NULL AND cv.value::text NOT IN ('null','""')))`;
    }

    // Values are stored as JSONB. Compare against the unwrapped scalar so a numeric
    // field behaves numerically instead of comparing "10" < "9" as text.
    const text = `(cv.value #>> '{}')`;
    const clause = this.scalarClause(node, text, 'text');
    return `EXISTS (${base} AND ${clause})`;
  }

  private conversationCondition(node: Condition): string {
    const spec = CONVERSATION_COLUMNS[node.field];
    if (!spec) throw this.unknownField(node.field);

    const inner = `SELECT 1 FROM "Conversation" co WHERE co."contactId" = c.id`;
    if (node.operator === 'is_set') return `EXISTS (${inner} AND co.${spec.column} IS NOT NULL)`;
    if (node.operator === 'is_not_set')
      return `(NOT EXISTS (${inner} AND co.${spec.column} IS NOT NULL))`;

    const clause = this.scalarClause(node, `co.${spec.column}`, spec.type);
    return `EXISTS (${inner} AND ${clause})`;
  }

  private columnCondition(
    node: Condition,
    columns: Record<string, { column: string; type: string }>,
    prefix: string,
  ): string {
    const spec = columns[node.field];
    if (!spec) throw this.unknownField(node.field);

    const expr = `${prefix}${spec.column}`;
    if (node.operator === 'is_set') return `${expr} IS NOT NULL AND ${expr}::text <> ''`;
    if (node.operator === 'is_not_set') return `(${expr} IS NULL OR ${expr}::text = '')`;

    return this.scalarClause(node, expr, spec.type);
  }

  private scalarClause(node: Condition, expr: string, type: string): string {
    const value = node.value;

    switch (node.operator) {
      case 'eq':
        return `${expr}::text = ${this.bind(String(value ?? ''))}`;
      case 'neq':
        return `(${expr} IS NULL OR ${expr}::text <> ${this.bind(String(value ?? ''))})`;
      case 'contains':
        return `${expr}::text ILIKE ${this.bind(`%${this.escapeLike(String(value ?? ''))}%`)}`;
      case 'not_contains':
        return `(${expr} IS NULL OR ${expr}::text NOT ILIKE ${this.bind(`%${this.escapeLike(String(value ?? ''))}%`)})`;
      case 'starts_with':
        return `${expr}::text ILIKE ${this.bind(`${this.escapeLike(String(value ?? ''))}%`)}`;
      case 'ends_with':
        return `${expr}::text ILIKE ${this.bind(`%${this.escapeLike(String(value ?? ''))}`)}`;
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[node.operator];
        const cast = type === 'timestamp' ? 'timestamptz' : 'numeric';
        const guard =
          cast === 'numeric'
            ? `${expr}::text ~ '^-?[0-9]+(\\.[0-9]+)?$'`
            : `${expr} IS NOT NULL`;
        return `(${guard} AND ${expr}::text::${cast} ${op} ${this.bind(String(value ?? ''))}::${cast})`;
      }
      case 'in':
      case 'not_in': {
        const list = Array.isArray(value) ? value.map((v) => String(v ?? '')) : [];
        if (list.length === 0) return node.operator === 'in' ? 'FALSE' : 'TRUE';
        const placeholder = this.bind(list);
        return node.operator === 'in'
          ? `${expr}::text = ANY(${placeholder}::text[])`
          : `(${expr} IS NULL OR NOT (${expr}::text = ANY(${placeholder}::text[])))`;
      }
      case 'before':
        return `(${expr} IS NOT NULL AND ${expr}::text::timestamptz < ${this.bind(String(value ?? ''))}::timestamptz)`;
      case 'after':
        return `(${expr} IS NOT NULL AND ${expr}::text::timestamptz > ${this.bind(String(value ?? ''))}::timestamptz)`;
      case 'within_days':
        return `(${expr} IS NOT NULL AND ${expr}::text::timestamptz >= now() - (${this.bind(String(Number(value) || 0))}::numeric * interval '1 day'))`;
      case 'older_than_days':
        return `(${expr} IS NOT NULL AND ${expr}::text::timestamptz < now() - (${this.bind(String(Number(value) || 0))}::numeric * interval '1 day'))`;
      default:
        throw new DmFlowError('VALIDATION_FAILED', {
          details: [{ path: 'operator', message: `unsupported operator ${node.operator}` }],
        });
    }
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (m) => `\\${m}`);
  }

  private unknownField(field: string): DmFlowError {
    return new DmFlowError('VALIDATION_FAILED', {
      details: [{ path: 'field', message: `unknown field: ${field}` }],
    });
  }
}

export function compilePredicate(node: PredicateNode): CompiledPredicate {
  return new Compiler().compile(node);
}
