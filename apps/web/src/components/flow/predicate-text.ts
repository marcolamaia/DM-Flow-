import type { PreviewLookups } from './node-preview';

type Lang = 'pt-BR' | 'en';

/**
 * Turns a predicate into a sentence.
 *
 * A condition block that says only "Condition" is useless on a canvas: the whole
 * reason to look at a flow rather than its configuration is to see, at a glance,
 * which way it branches and why.
 */

const OPERATORS: Record<string, Record<Lang, string>> = {
  eq: { 'pt-BR': 'é', en: 'is' },
  neq: { 'pt-BR': 'não é', en: 'is not' },
  contains: { 'pt-BR': 'contém', en: 'contains' },
  not_contains: { 'pt-BR': 'não contém', en: 'does not contain' },
  starts_with: { 'pt-BR': 'começa com', en: 'starts with' },
  ends_with: { 'pt-BR': 'termina com', en: 'ends with' },
  gt: { 'pt-BR': '>', en: '>' },
  gte: { 'pt-BR': '≥', en: '≥' },
  lt: { 'pt-BR': '<', en: '<' },
  lte: { 'pt-BR': '≤', en: '≤' },
  is_set: { 'pt-BR': 'está preenchido', en: 'is set' },
  is_not_set: { 'pt-BR': 'está vazio', en: 'is empty' },
  in: { 'pt-BR': 'é um de', en: 'is one of' },
  not_in: { 'pt-BR': 'não é nenhum de', en: 'is none of' },
  before: { 'pt-BR': 'antes de', en: 'before' },
  after: { 'pt-BR': 'depois de', en: 'after' },
  within_days: { 'pt-BR': 'nos últimos (dias)', en: 'within days' },
  older_than_days: { 'pt-BR': 'há mais de (dias)', en: 'older than days' },
};

/** Operators that read as a complete statement on their own. */
const VALUELESS = new Set(['is_set', 'is_not_set']);

const JOIN: Record<'and' | 'or', Record<Lang, string>> = {
  and: { 'pt-BR': ' e ', en: ' and ' },
  or: { 'pt-BR': ' ou ', en: ' or ' },
};

const CONTACT_FIELDS: Record<string, Record<Lang, string>> = {
  displayName: { 'pt-BR': 'nome', en: 'name' },
  username: { 'pt-BR': 'usuário', en: 'username' },
  status: { 'pt-BR': 'situação', en: 'status' },
  locale: { 'pt-BR': 'idioma', en: 'language' },
  createdAt: { 'pt-BR': 'data de entrada', en: 'joined at' },
  lastInboundAt: { 'pt-BR': 'última mensagem recebida', en: 'last message received' },
};

function subjectOf(
  source: string,
  field: string,
  lang: Lang,
  lookups: PreviewLookups,
): string {
  switch (source) {
    case 'tag': {
      const tag = lookups.tags.find((entry) => entry.id === field);
      const label = lang === 'en' ? 'tag' : 'tag';
      return tag ? `${label} "${tag.name}"` : label;
    }
    case 'custom_field': {
      const custom = lookups.fields.find((entry) => entry.id === field);
      return custom ? custom.label || custom.key : lang === 'en' ? 'field' : 'campo';
    }
    case 'contact':
      return CONTACT_FIELDS[field]?.[lang] ?? field;
    case 'conversation':
      return lang === 'en' ? `conversation ${field}` : `conversa ${field}`;
    default:
      return field;
  }
}

function valueOf(value: unknown): string {
  if (Array.isArray(value)) return value.slice(0, 3).map(String).join(', ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  return String(value);
}

/**
 * Returns null when the predicate is missing or still empty, which the caller
 * uses to mark the block as needing configuration.
 */
export function describePredicate(
  predicate: unknown,
  lang: Lang,
  lookups: PreviewLookups,
  depth = 0,
): string | null {
  if (!predicate || typeof predicate !== 'object') return null;
  const node = predicate as Record<string, unknown>;

  switch (node.kind) {
    case 'always':
      return lang === 'en' ? 'always' : 'sempre';

    case 'condition': {
      const source = String(node.source ?? '');
      const field = String(node.field ?? '');
      if (!source || !field) return null;

      const subject = subjectOf(source, field, lang, lookups);
      const operator = OPERATORS[String(node.operator)]?.[lang] ?? String(node.operator ?? '');
      if (VALUELESS.has(String(node.operator))) return `${subject} ${operator}`;

      const value = valueOf(node.value);
      return value ? `${subject} ${operator} ${value}` : `${subject} ${operator}`;
    }

    case 'and':
    case 'or': {
      const children = (node.children ?? []) as unknown[];
      const parts = children
        .map((child) => describePredicate(child, lang, lookups, depth + 1))
        .filter((part): part is string => Boolean(part));
      if (parts.length === 0) return null;

      const joined = parts.join(JOIN[node.kind as 'and' | 'or'][lang]);
      // Parenthesised only when nested, so a single group does not read as maths.
      return depth > 0 ? `(${joined})` : joined;
    }

    case 'not': {
      const child = describePredicate(node.child, lang, lookups, depth + 1);
      return child ? (lang === 'en' ? `not ${child}` : `não ${child}`) : null;
    }

    default:
      return null;
  }
}
