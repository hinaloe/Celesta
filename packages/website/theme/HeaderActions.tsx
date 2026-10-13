import { getHomeRoute, getPageMap, getSearchIndex } from '@natsuneko-laboratory/makit-runtime';
import type { GeneratedPage, GeneratedStaticPage, I18nData, LocaleData, SiteData, ThemeComponents } from '@natsuneko-laboratory/makit-runtime';
import { copy, isLocale } from '../site/copy/index.ts';
import { LocaleLinks, type LocaleLink } from './LocaleLinks.tsx';

/**
 * Where the switch to `target` leads. A docs page goes to the same page id in that locale, or a
 * fallback page standing in for it, and otherwise follows `localeSwitcher.missingPage`, as
 * Makit's `LocaleSwitcher` does. A static page uses its alternates, otherwise that locale's home.
 */
async function hrefIn(page: GeneratedPage | GeneratedStaticPage, target: LocaleData, i18n: I18nData): Promise<string | undefined> {
  if ('collectionId' in page) {
    const own = (await getPageMap())[target.urlLocale]?.[page.collectionId]?.[page.pageId];
    if (own) return own.route;
    return i18n.localeSwitcher.missingPage === 'locale-root' ? getHomeRoute(target.urlLocale) : undefined;
  }
  return page.metadata.alternates.find((alternate) => alternate.urlLocale === target.urlLocale)?.href ?? getHomeRoute(target.urlLocale);
}

/**
 * The header actions of every page shell: Makit's search, the Noir `EN / JA` switch, and
 * Makit's theme toggle (Makit's own `HeaderActions` and `LocaleLinks` are not exported).
 */
export async function HeaderActions({ page, site, i18n, components: C }: { page: GeneratedPage | GeneratedStaticPage; site: SiteData; i18n: I18nData; components: ThemeComponents }) {
  const searchEntries = await getSearchIndex(page.locale);
  const localeLinks: LocaleLink[] = [];
  if (i18n.enabled) {
    for (const candidate of i18n.locales) {
      const current = candidate.urlLocale === page.locale;
      const href = current ? page.route : await hrefIn(page, candidate, i18n);
      if (href) localeLinks.push({ locale: candidate.urlLocale, label: candidate.label, href, current });
    }
  }
  return <>
    <C.SearchDialog entries={searchEntries} pagefindEnabled={process.env.NODE_ENV === 'production'} pagefindBundlePath={`${site.basePath}/pagefind/`} />
    <LocaleLinks links={localeLinks} label={copy(isLocale(page.locale) ? page.locale : 'en').common.navigation.language} />
    {site.theme.colorScheme === 'system' && <C.ThemeToggle />}
  </>;
}
