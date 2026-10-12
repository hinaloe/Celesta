import type { RootLayoutProps } from '@natsuneko-laboratory/makit-runtime';
import { copy } from '../site/copy/index.ts';
import { DocumentLocale } from './DocumentLocale.tsx';
import { locales } from './locale.ts';

/** Sets `<html lang>` and `data-tg-locale` from the URL before first paint (see `DocumentLocale`). */
const localeScript = `(function(){var l=${JSON.stringify(locales)},s=location.pathname.split('/')[1],d=document.documentElement;s=l.indexOf(s)<0?l[0]:s;d.lang=s;d.setAttribute('data-tg-locale',s)})()`;

/**
 * The document shell (Makit THEME §10.3): `htmlProps` and `bodyProps` spread once, `bodyStart`
 * first in `<body>`. The skip link carries every locale's label; CSS shows the one in
 * `data-tg-locale`, because the root layout is shared and cannot see the page's locale.
 */
export function RootLayout({ htmlProps, bodyProps, bodyStart, children }: RootLayoutProps) {
  return <html {...htmlProps}>
    <body {...bodyProps}>
      {bodyStart}
      <script dangerouslySetInnerHTML={{ __html: localeScript }} />
      <DocumentLocale locales={locales} />
      <a className="tg-skip" href="#main">
        {locales.map((locale) => <span key={locale} lang={locale} data-tg-variant={locale}>{copy(locale).home.skipToContent}</span>)}
      </a>
      {children}
    </body>
  </html>;
}
