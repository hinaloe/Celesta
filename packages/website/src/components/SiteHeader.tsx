import { useState } from 'react';
import { Brand } from './Brand';
import { LanguageSwitcher } from './LanguageSwitcher';
import { allDownloads } from './download-links';
import { currentLocale, homePath, t } from '../site/i18n';
import { repository } from '../site/links';
import { docPath, showcasePath } from '../site/routes';

/** The header on every page. Below 860 px the navigation folds behind a menu button. */
export function SiteHeader({ current }: { current?: 'docs' | 'showcase' }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header id="top" className="header">
    <div className="shell header-inner flex items-center justify-between">
      <Brand />
      <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="navigation" onClick={() => setMenuOpen(!menuOpen)}>{t(menuOpen ? 'common.navigation.close' : 'common.navigation.menu')}</button>
      <nav id="navigation" aria-label={t('common.navigation.main')} className={`nav flex items-center ${menuOpen ? 'is-open' : ''}`} onClick={() => setMenuOpen(false)}>
        <a href={docPath('overview')} aria-current={current === 'docs' ? 'true' : undefined}>{t('common.navigation.docs')}</a>
        <a href={showcasePath('', currentLocale)} aria-current={current === 'showcase' ? 'true' : undefined}>{t('common.navigation.showcase')}</a>
        <a href={`${homePath}#playground`}>{t('common.navigation.playground')}</a>
        <a href={repository}>{t('common.navigation.github')} <span aria-hidden="true">↗</span></a>
        <a className="nav-download" href={allDownloads}>{t('common.navigation.download')} <span aria-hidden="true">↓</span></a>
        <LanguageSwitcher />
      </nav>
    </div>
  </header>;
}
