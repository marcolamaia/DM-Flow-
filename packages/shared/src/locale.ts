export const LOCALES = ['pt-BR', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

/** A message that always carries both locales, so nothing reaches a user untranslated. */
export interface LocalizedMessage {
  'pt-BR': string;
  en: string;
}

export function localize(message: LocalizedMessage, locale: Locale): string {
  return message[locale] ?? message[DEFAULT_LOCALE];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
