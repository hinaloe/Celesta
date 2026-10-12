import type { HeaderProps } from '@natsuneko-laboratory/makit-runtime';
import { copy } from '../site/copy/index.ts';
import { Brand } from './Brand.tsx';
import { HeaderMenu, type NavLink } from './HeaderMenu.tsx';
import { localeOf } from './locale.ts';

// Ruling R2: Task 8 replaces this with `downloadLinks().all`.
const downloadHref = 'https://github.com/mika-f/Celesta/releases/latest';

/**
 * Wordmark, the site sections, `header.links` from `makit.config.ts`, the download button, then
 * the shell's `actions` (search, language, theme). The locale comes from `homeHref`.
 */
export function Header({ header, siteTitle, homeHref, actions }: HeaderProps) {
  const locale = localeOf(homeHref);
  const { navigation } = copy(locale).common;
  const links: NavLink[] = [
    { href: `/${locale}/docs/`, label: navigation.docs, section: true },
    { href: `/${locale}/showcase/`, label: navigation.showcase, section: true },
    { href: `/${locale}/#playground`, label: navigation.playground },
    ...(header.links ?? []),
  ];
  return <header className="tg-header">
    <div className="tg-shell tg-header-inner">
      <Brand href={homeHref} label={navigation.label} title={header.title ?? siteTitle} />
      <HeaderMenu links={links} download={{ href: downloadHref, label: navigation.download }} labels={{ menu: navigation.menu, close: navigation.close, main: navigation.main }} />
      {actions && <div className="tg-header-actions">{actions}</div>}
    </div>
  </header>;
}
