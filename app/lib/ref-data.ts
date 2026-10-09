/**
 * Store options live in code: the lists are tiny and static, so zod enums are
 * the contract and Postgres only enforces the code *format* (migration 00010).
 * Locale codes keep their region — `es-CO` is what makes Intl render
 * `$ 79.900` for COP — while the labels stay friendly.
 */

export const CURRENCIES = ["COP", "USD"] as const;
export const LOCALES = ["es-CO", "en-US"] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];
export type LocaleCode = (typeof LOCALES)[number];

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  COP: "Colombian peso",
  USD: "US dollar",
};

/** Language endonym plus its region, so the picker reads naturally. */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  "es-CO": "Español (Colombia)",
  "en-US": "English (United States)",
};

export function localeLabel(locale: string): string {
  return LOCALE_LABELS[locale as LocaleCode] ?? locale;
}

export function isCurrencyCode(value: string | null | undefined): value is CurrencyCode {
  return !!value && (CURRENCIES as readonly string[]).includes(value);
}

export function isLocaleCode(value: string | null | undefined): value is LocaleCode {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
