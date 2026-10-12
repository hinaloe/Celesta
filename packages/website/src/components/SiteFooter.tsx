import { Brand } from './Brand';
import { currentLocale, t } from '../site/i18n';
import { repository } from '../site/links';
import { docPath, showcasePath } from '../site/routes';

/** The footer on every page. */
export function SiteFooter() {
  return <footer className="footer shell">
    <div className="footer-top">
      <div><Brand /><p>{t('common.footer.tagline')}</p></div>
      <nav aria-label={t('common.footer.label')}>
        <a href={docPath('overview')}>{t('common.footer.documentation')}</a>
        <a href={showcasePath('', currentLocale)}>{t('common.navigation.showcase')}</a>
        <a href={repository}>{t('common.navigation.github')}</a>
        <a href={`${repository}/releases`}>{t('common.footer.releases')}</a>
        <a href={`${repository}/issues`}>{t('common.footer.issues')}</a>
      </nav>
    </div>
    <div className="footer-bottom flex flex-wrap justify-between gap-3"><span>{t('common.footer.built-with')}</span><span>{t('common.footer.license')}</span></div>
  </footer>;
}
