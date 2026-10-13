import type { FooterProps } from '@natsuneko-laboratory/makit-runtime';
import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import { copy, type Locale } from '../site/copy/index.ts';
import { repository } from '../site/links.ts';
import { Brand } from './Brand.tsx';
import { ByLocale } from './LocaleContext.tsx';

function FooterBody({ locale }: { locale: Locale }) {
  const { navigation, footer } = copy(locale).common;
  return <div className="nr-shell">
    <div className="nr-footer-top">
      <div className="nr-footer-brand">
        <Brand href={`/${locale}/`} label={navigation.label} />
        <p>{footer.tagline}</p>
      </div>
      <nav className="nr-footer-nav" aria-label={footer.label}>
        <RouteLink href={`/${locale}/docs/`}>{footer.documentation}</RouteLink>
        <RouteLink href={`/${locale}/showcase/`}>{navigation.showcase}</RouteLink>
        <a href={repository}>{navigation.github}</a>
        <a href={`${repository}/releases`}>{footer.releases}</a>
        <a href={`${repository}/issues`}>{footer.issues}</a>
      </nav>
    </div>
    <div className="nr-footer-bottom nr-mono">
      <span>{footer.builtWith}</span>
      <span>{footer.license}</span>
    </div>
  </div>;
}

/** `FooterProps` carries no locale, so both variants render and the page's `LocaleProvider` picks one. */
export function Footer(_: FooterProps) {
  return <footer className="nr-footer">
    <ByLocale en={<FooterBody locale="en" />} ja={<FooterBody locale="ja" />} />
  </footer>;
}
