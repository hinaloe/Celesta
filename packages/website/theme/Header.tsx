import type { HeaderProps } from '@natsuneko-laboratory/makit-runtime';
import { copy } from '../site/copy/index.ts';
import { downloadLinks } from '../site/downloads.ts';
import { Brand } from './Brand.tsx';
import { HeaderMenu, type NavLink } from './HeaderMenu.tsx';
import { localeOf } from './locale.ts';

/**
 * Wordmark, the site sections and `header.links` from `makit.config.ts` as tabs, the shell's
 * `actions` (search, language, theme), then the download button. Below 860 px the download button
 * moves into the menu panel (`HeaderMenu` renders that copy). The locale comes from `homeHref`.
 */
export function Header({ header, siteTitle, homeHref, actions }: HeaderProps) {
  const locale = localeOf(homeHref);
  const { navigation } = copy(locale).common;
  const download = { href: downloadLinks().all, label: navigation.download };
  const links: NavLink[] = [
    { href: `/${locale}/docs/`, label: navigation.docs, section: true },
    { href: `/${locale}/showcase/`, label: navigation.showcase, section: true },
    { href: `/${locale}/#playground`, label: navigation.playground },
    ...(header.links ?? []),
  ];
  return <header className="nr-header">
    <div className="nr-shell nr-header-inner">
      <Brand href={homeHref} label={navigation.label} title={header.title ?? siteTitle} />
      <HeaderMenu links={links} download={download} labels={{ menu: navigation.menu, close: navigation.close, main: navigation.main }} />
      {actions && <div className="nr-header-actions">{actions}</div>}
      <a className="nr-button nr-header-download" href={download.href}>{download.label}</a>
    </div>
  </header>;
}
