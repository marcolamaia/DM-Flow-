import { describe, expect, it } from 'vitest';
import { TRIGGER_DEFINITIONS, matchesKeywords, parseTriggerConfig } from '../triggers';

const base = { includeKeywords: [], excludeKeywords: [], matchMode: 'contains' as const, caseSensitive: false };

describe('keyword matching', () => {
  it('matches case-insensitively by default', () => {
    expect(matchesKeywords('Eu QUERO o link', { ...base, includeKeywords: ['quero'] })).toBe(true);
  });

  it('lets exclusions veto a match', () => {
    expect(
      matchesKeywords('nao quero isso', {
        ...base,
        includeKeywords: ['quero'],
        excludeKeywords: ['nao quero'],
      }),
    ).toBe(false);
  });

  it('treats an empty include list as "any message that survived exclusions"', () => {
    expect(matchesKeywords('qualquer coisa', base)).toBe(true);
    expect(matchesKeywords('spam aqui', { ...base, excludeKeywords: ['spam'] })).toBe(false);
  });

  it('honours exact and starts_with modes', () => {
    expect(matchesKeywords('quero', { ...base, includeKeywords: ['quero'], matchMode: 'exact' })).toBe(true);
    expect(matchesKeywords('quero muito', { ...base, includeKeywords: ['quero'], matchMode: 'exact' })).toBe(false);
    expect(
      matchesKeywords('quero muito', { ...base, includeKeywords: ['quero'], matchMode: 'starts_with' }),
    ).toBe(true);
  });
});

describe('trigger registry', () => {
  it('never guesses a webhook field name', () => {
    // Empty means "PHASE 0 has not confirmed this". A plausible-looking field name
    // here would be exactly the fabrication this project forbids.
    for (const definition of Object.values(TRIGGER_DEFINITIONS)) {
      expect(definition.sourceWebhookField).toBe('');
    }
  });

  it('marks exactly one trigger as the catch-all', () => {
    const catchAlls = Object.values(TRIGGER_DEFINITIONS).filter((d) => d.isCatchAll);
    expect(catchAlls).toHaveLength(1);
    expect(catchAlls[0]!.type).toBe('ig_dm_default');
    // A catch-all must rank below everything specific.
    expect(catchAlls[0]!.defaultPriority).toBe(0);
  });

  it('validates trigger config at the boundary', () => {
    expect(parseTriggerConfig('ig_comment', { includeKeywords: ['quero'] }).success).toBe(true);
    expect(parseTriggerConfig('contact_tag_added', {}).success).toBe(false);
  });

  it('requires no channel capability for layer-1 triggers', () => {
    for (const type of ['manual_enrollment', 'contact_tag_added', 'inbound_api'] as const) {
      expect(TRIGGER_DEFINITIONS[type].requiredCapabilities).toHaveLength(0);
      expect(TRIGGER_DEFINITIONS[type].channel).toBeNull();
    }
  });
});
