import { getHomeRoute } from '@natsuneko-laboratory/makit-runtime';
import type { StaticPageProps } from '@natsuneko-laboratory/makit-runtime';
import { isLocale } from '../site/copy/index.ts';
import { HeaderActions } from './HeaderActions.tsx';
import { LocaleProvider } from './LocaleContext.tsx';

/**
 * Header, a full-width `<main>`, and Footer (Makit STATIC-PAGES §10). The body is unpadded so
 * landing sections lay themselves out; `data-pagefind-body` only when the page opts into search.
 */
export async function StaticPage({ page, site, i18n, locale: urlLocale, components: C, children }: StaticPageProps) {
  const locale = isLocale(urlLocale) ? urlLocale : 'en';
  const body = page.search ? <div data-pagefind-body>{children}</div> : children;
  if (page.layout === 'bare') return <LocaleProvider locale={locale}>{body}</LocaleProvider>;

  const homeHref = (await getHomeRoute(urlLocale)) ?? `${site.basePath}/${locale}/`;
  return <LocaleProvider locale={locale}>
    <div className="nr-page">
      <C.Header header={site.header} siteTitle={site.title} homeHref={homeHref} actions={<HeaderActions page={page} site={site} i18n={i18n} components={C} />} />
      <main id="main" className="nr-main" tabIndex={-1}>{body}</main>
      <C.Footer footer={site.footer} />
    </div>
  </LocaleProvider>;
}
