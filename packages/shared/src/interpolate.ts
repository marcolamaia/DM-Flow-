/**
 * Message templating. Deliberately a token substituter, not an expression language:
 * `{{contact.displayName}}` resolves a path and nothing else. No arithmetic, no calls,
 * no property access that can reach a prototype.
 */

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]{1,120})\s*\}\}/g;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export interface InterpolationContext {
  contact?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
}

function resolvePath(context: InterpolationContext, path: string): unknown {
  const segments = path.split('.');
  if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) return undefined;

  const [root, ...rest] = segments;
  if (!root) return undefined;

  const source = (context as Record<string, unknown>)[root];
  if (source === undefined || source === null) return undefined;

  return rest.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

/**
 * Unresolved tokens render as empty string rather than failing the step. A message
 * missing a first name is recoverable; a halted automation mid-conversation is not.
 * The builder warns about unknown tokens at design time instead.
 */
export function interpolate(template: string, context: InterpolationContext): string {
  return template.replace(TOKEN_PATTERN, (_match, path: string) =>
    stringify(resolvePath(context, path)),
  );
}

/** Tokens referenced by a template, so the builder can validate them. */
export function extractTokens(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}
