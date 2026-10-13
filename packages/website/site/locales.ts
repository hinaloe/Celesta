import type { Locale } from './copy/index.ts';

/** The site's languages and their native names; Makit's `i18n.locales` in makit.config.ts must match. */
export const locales = { en: 'English', ja: '日本語' } as const satisfies Record<Locale, string>;
const localeCodes = Object.keys(locales) as Locale[];
const defaultLocale: Locale = 'en';

/** Respect browser preference order and quality values, including regional tags. */
export function preferredLocale(acceptLanguage: string | null): Locale {
  const preferences = (acceptLanguage ?? '').split(',').map(value => {
    const [tag, ...parameters] = value.toLowerCase().split(';').map(part => part.trim());
    const quality = parameters.find(parameter => parameter.startsWith('q='));
    const weight = quality ? Number(quality.slice(2)) : 1;
    return { tag, weight };
  }).filter(({ tag, weight }) => tag && Number.isFinite(weight) && weight >= 0 && weight <= 1);
  const matchLocale = (tag: string) => localeCodes.find(locale => locale.toLowerCase() === tag)
    ?? localeCodes.find(locale => locale.toLowerCase().split('-')[0] === tag.split('-')[0]);
  // Wildcards cover only locales without an explicit preference, including q=0.
  const explicit = new Set(preferences.filter(({ tag }) => tag !== '*').map(({ tag }) => matchLocale(tag)));
  for (const { tag } of preferences.filter(({ weight }) => weight > 0).sort((a, b) => b.weight - a.weight)) {
    if (tag === '*') {
      const match = localeCodes.find(locale => !explicit.has(locale));
      if (match) return match;
      continue;
    }
    const match = matchLocale(tag);
    if (match) return match;
  }
  return defaultLocale;
}

export function languageRedirect(url: URL, acceptLanguage: string | null): URL | null {
  if (url.pathname !== '/' && url.pathname !== '/index.html') return null;
  const target = new URL(url);
  target.pathname = `/${preferredLocale(acceptLanguage)}/`;
  return target;
}
