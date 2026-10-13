import { isLocale, type Locale } from '../site/copy/index.ts';

/** Locales in the order the site lists them. */
export const locales: readonly Locale[] = ['en', 'ja'];

/** The locale named by a path's first segment (`/ja/docs/` → `ja`), or `en`. */
export const localeOf = (path: string): Locale => {
  const first = path.split('/').find(Boolean) ?? '';
  return isLocale(first) ? first : 'en';
};
