import { localeFromPath, type Locale } from './locales.ts';

/** The page an address shows. Documentation and showcase index pages have the slug `overview`. */
export type Route =
  | { locale: Locale; page: 'home' }
  | { locale: Locale; page: 'docs' | 'showcase'; slug: string }
  | { locale: Locale; page: 'other' };

/** Read an address. Paths without a language, such as the legacy `/docs/export/`, are English. */
export function parseRoute(pathname: string): Route {
  const locale = localeFromPath(pathname);
  const prefix = `/${locale}/`;
  const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length - 1) : pathname;
  if (path === '/' || path === '/index.html') return { locale, page: 'home' };
  for (const page of ['docs', 'showcase'] as const) {
    if (path === `/${page}/index.html`) return { locale, page, slug: 'overview' };
    const match = new RegExp(`^/${page}/(?:([a-z0-9-]+)/?)?$`).exec(path);
    if (match) return { locale, page, slug: match[1] ?? 'overview' };
  }
  return { locale, page: 'other' };
}

const windowLocale = () => localeFromPath(typeof window === 'undefined' ? '/en/' : window.location.pathname);

/** The path of a documentation page. The overview is `/<locale>/docs/`. */
export function docPath(slug: string, locale: Locale = windowLocale()): string {
  return slug === 'overview' ? `/${locale}/docs/` : `/${locale}/docs/${slug}/`;
}

/** The path of a showcase entry, or of the gallery when `slug` is empty. */
export const showcasePath = (slug = '', locale = 'en') => `/${locale}/showcase/${slug ? `${slug}/` : ''}`;
