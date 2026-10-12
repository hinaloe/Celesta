import { RouteLink } from '@natsuneko-laboratory/makit-runtime';

export interface LocaleLink {
  locale: string;
  label: string;
  href: string;
  current: boolean;
}

/** `EN / JA` — the language switch for shells without Makit's `LocaleSwitcher` page (static pages, 404). */
export function LocaleLinks({ links, label }: { links: readonly LocaleLink[]; label: string }) {
  if (links.length < 2) return null;
  return <nav className="tg-locale tg-mono" aria-label={label}>
    {links.map((link, index) => <span key={link.locale}>
      {index > 0 && <span className="tg-locale-sep" aria-hidden="true">/</span>}
      <RouteLink href={link.href} hrefLang={link.locale} lang={link.locale} title={link.label} aria-label={`${link.label} (${link.locale.toUpperCase()})`} aria-current={link.current ? 'true' : undefined}>{link.locale.toUpperCase()}</RouteLink>
    </span>)}
  </nav>;
}
