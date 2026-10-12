import { getHomeRoute, getSearchIndex } from '@natsuneko-laboratory/makit-runtime';
import type { StaticPageProps } from '@natsuneko-laboratory/makit-runtime';
import { copy, isLocale } from '../site/copy/index.ts';
import { LocaleProvider } from './LocaleContext.tsx';
import { LocaleLinks, type LocaleLink } from './LocaleLinks.tsx';

/**
 * Header, a full-width `<main>`, and Footer (Makit STATIC-PAGES §10). The body is unpadded so
 * landing sections lay themselves out; `data-pagefind-body` only when the page opts into search.
 */
export async function StaticPage({ page, site, i18n, locale: urlLocale, components: C, children }: StaticPageProps) {
  const locale = isLocale(urlLocale) ? urlLocale : 'en';
  const body = page.search ? <div data-pagefind-body>{children}</div> : children;
  if (page.layout === 'bare') return <LocaleProvider locale={locale}>{body}</LocaleProvider>;

  const [homeHref, searchEntries] = await Promise.all([
    getHomeRoute(urlLocale).then((href) => href ?? `${site.basePath}/`),
    getSearchIndex(urlLocale),
  ]);
  // The same page in each locale where it exists, otherwise that locale's home.
  const localeLinks: LocaleLink[] = [];
  if (i18n.enabled) {
    for (const candidate of i18n.locales) {
      const current = candidate.urlLocale === page.locale;
      const href = current
        ? page.route
        : page.metadata.alternates.find((alternate) => alternate.urlLocale === candidate.urlLocale)?.href ?? await getHomeRoute(candidate.urlLocale);
      if (href) localeLinks.push({ locale: candidate.urlLocale, label: candidate.label, href, current });
    }
  }

  return <LocaleProvider locale={locale}>
    <div className="tg-page">
      <C.Header
        header={site.header}
        siteTitle={site.title}
        homeHref={homeHref}
        actions={<>
          <C.SearchDialog entries={searchEntries} pagefindEnabled={process.env.NODE_ENV === 'production'} pagefindBundlePath={`${site.basePath}/pagefind/`} />
          <LocaleLinks links={localeLinks} label={copy(locale).common.navigation.language} />
          {site.theme.colorScheme === 'system' && <C.ThemeToggle />}
        </>}
      />
      <main id="main" className="tg-main" tabIndex={-1}>{body}</main>
      <C.Footer footer={site.footer} />
    </div>
  </LocaleProvider>;
}
