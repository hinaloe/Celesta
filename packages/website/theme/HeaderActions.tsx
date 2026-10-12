import { getHomeRoute, getSearchIndex } from '@natsuneko-laboratory/makit-runtime';
import type { I18nData, SiteData, ThemeComponents } from '@natsuneko-laboratory/makit-runtime';
import { copy, isLocale } from '../site/copy/index.ts';
import { LocaleLinks, type LocaleLink } from './LocaleLinks.tsx';

/** What a page shell knows about the page it renders: a docs page or a static page. */
export interface ActionsPage {
  locale: string;
  route: string;
  metadata: { alternates: readonly { urlLocale: string; href: string }[] };
}

/**
 * The header actions of every page shell: Makit's search, the Tungsten `EN / JA` switch, and
 * Makit's theme toggle. Each locale link points to the same page in that locale where it exists,
 * otherwise to that locale's home (Makit's own `HeaderActions` and `LocaleLinks` are not exported).
 */
export async function HeaderActions({ page, site, i18n, components: C }: { page: ActionsPage; site: SiteData; i18n: I18nData; components: ThemeComponents }) {
  const searchEntries = await getSearchIndex(page.locale);
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
  return <>
    <C.SearchDialog entries={searchEntries} pagefindEnabled={process.env.NODE_ENV === 'production'} pagefindBundlePath={`${site.basePath}/pagefind/`} />
    <LocaleLinks links={localeLinks} label={copy(isLocale(page.locale) ? page.locale : 'en').common.navigation.language} />
    {site.theme.colorScheme === 'system' && <C.ThemeToggle />}
  </>;
}
