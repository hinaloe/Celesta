import { RouteLink, getHomeRoute, getLocalesData, getSiteData } from '@natsuneko-laboratory/makit-runtime';
import type { NotFoundPageProps } from '@natsuneko-laboratory/makit-runtime';
import type { ReactNode } from 'react';
import { copy, type Locale } from '../site/copy/index.ts';
import { DocumentTitle } from './DocumentLocale.tsx';
import { LocaleProvider } from './LocaleContext.tsx';
import { LocaleLinks } from './LocaleLinks.tsx';
import { locales } from './locale.ts';

/** One locale's copy of a region; CSS shows the variant matching `data-tg-locale` (set in `RootLayout`). */
const Variants = ({ render }: { render: (locale: Locale) => ReactNode }) => locales.map((locale) =>
  <div key={locale} lang={locale} data-tg-variant={locale}><LocaleProvider locale={locale}>{render(locale)}</LocaleProvider></div>);

/**
 * Makit exports a single `404.html` for every URL, so the page cannot know its locale at build
 * time. Every locale renders, and the one named by the URL's first segment is shown.
 */
export async function NotFoundPage({ components: C }: NotFoundPageProps) {
  const [site, i18n] = await Promise.all([getSiteData(), getLocalesData()]);
  const homes = Object.fromEntries(await Promise.all(locales.map(async (locale) =>
    [locale, (await getHomeRoute(locale)) ?? `${site.basePath}/${locale}/`] as const))) as Record<Locale, string>;
  const localeLinks = (current: Locale) => locales.map((locale) =>
    ({ locale, label: i18n.locales.find((candidate) => candidate.urlLocale === locale)?.label ?? locale, href: homes[locale], current: locale === current }));

  const titles = Object.fromEntries(locales.map((locale) => [locale, copy(locale).notFound.title]));
  // `<title>` is hoisted and the first one wins; the script fixes it before paint, `DocumentTitle` after hydration.
  const titleScript = `document.title=${JSON.stringify(titles).replace(/</g, '\\u003c')}[document.documentElement.getAttribute('data-tg-locale')]||document.title`;

  return <div className="tg-page">
    <title>{titles[locales[0]]}</title>
    <script dangerouslySetInnerHTML={{ __html: titleScript }} />
    <DocumentTitle titles={titles} />
    <Variants render={(locale) => <C.Header
      header={site.header}
      siteTitle={site.title}
      homeHref={homes[locale]}
      actions={<>
        <LocaleLinks links={localeLinks(locale)} label={copy(locale).common.navigation.language} />
        {site.theme.colorScheme === 'system' && <C.ThemeToggle />}
      </>}
    />} />
    <main id="main" className="tg-main tg-not-found" tabIndex={-1}>
      <Variants render={(locale) => {
        const { notFound } = copy(locale);
        return <div className="tg-shell">
          <p className="tg-timecode tg-mono" aria-hidden="true"><span className="tg-tally" />404 · --:--:--:--</p>
          <h1>{notFound.heading}</h1>
          <p className="tg-not-found-description">{notFound.description}</p>
          <RouteLink className="tg-button" href={homes[locale]}>{notFound.back}</RouteLink>
          <div className="tg-ruler" aria-hidden="true" />
        </div>;
      }} />
    </main>
    <Variants render={() => <C.Footer footer={site.footer} />} />
  </div>;
}
