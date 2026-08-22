import { describe, expect, it } from 'vitest';
import { extractTokens, interpolate } from '../interpolate';

describe('message interpolation', () => {
  it('substitutes known paths', () => {
    expect(interpolate('Oi {{contact.displayName}}!', { contact: { displayName: 'Ana' } })).toBe(
      'Oi Ana!',
    );
  });

  it('renders unknown tokens as empty rather than failing the step', () => {
    // A missing first name is recoverable; a halted automation mid-conversation
    // is not. The builder warns about unknown tokens at design time instead.
    expect(interpolate('Oi {{contact.nope}}!', { contact: {} })).toBe('Oi !');
  });

  it('refuses to walk the prototype chain', () => {
    expect(interpolate('{{contact.__proto__}}', { contact: { displayName: 'Ana' } })).toBe('');
    expect(interpolate('{{contact.constructor}}', { contact: {} })).toBe('');
    expect(interpolate('{{variables.a.prototype.b}}', { variables: { a: {} } })).toBe('');
  });

  it('is a substituter, not an expression language', () => {
    // No arithmetic, no calls — the token is a path or it renders empty.
    expect(interpolate('{{1+1}}', {})).toBe('{{1+1}}');
    expect(interpolate('{{alert(1)}}', {})).toBe('{{alert(1)}}');
  });

  it('lists the tokens a template references', () => {
    expect(extractTokens('a {{x.y}} b {{z}} c {{x.y}}')).toEqual(['x.y', 'z']);
  });
});
