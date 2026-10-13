import type { RootLayoutProps } from '@natsuneko-laboratory/makit-runtime';
import { copy } from '../site/copy/index.ts';
import { DocumentLocale } from './DocumentLocale.tsx';
import { locales } from './locale.ts';

/** Sets `<html lang>` and `data-nr-locale` from the URL before first paint (see `DocumentLocale`). */
const localeScript = `(function(){var l=${JSON.stringify(locales)},s=location.pathname.split('/')[1],d=document.documentElement;s=l.indexOf(s)<0?l[0]:s;d.lang=s;d.setAttribute('data-nr-locale',s)})()`;

/**
 * The document shell (Makit THEME §10.3): `htmlProps` and `bodyProps` spread once, `bodyStart`
 * first in `<body>`. The skip link carries every locale's label; CSS shows the one in
 * `data-nr-locale`, because the root layout is shared and cannot see the page's locale.
 */
export function RootLayout({ htmlProps, bodyProps, bodyStart, children }: RootLayoutProps) {
  return <html {...htmlProps}>
    <body {...bodyProps}>
      {bodyStart}
      {/* Makit has no icon or theme-color option; React hoists these into `<head>`. */}
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fafafa" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
      <script dangerouslySetInnerHTML={{ __html: localeScript }} />
      <DocumentLocale locales={locales} />
      <a className="nr-skip" href="#main">
        {locales.map((locale) => <span key={locale} lang={locale} data-nr-variant={locale}>{copy(locale).home.skipToContent}</span>)}
      </a>
      {children}
    </body>
  </html>;
}
