'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Makit renders one root layout for every locale, so `<html lang>` is always the default locale.
 * The inline script in `RootLayout` corrects it before first paint; this keeps it in step on
 * client-side navigation (e.g. the language switch). It reads `location` rather than the hook's
 * value, which is the not-found route's own path on a 404.
 */
export function DocumentLocale({ locales }: { locales: readonly string[] }) {
  const pathname = usePathname();
  useEffect(() => {
    const segment = window.location.pathname.split('/')[1] ?? '';
    const locale = locales.includes(segment) ? segment : locales[0];
    const root = document.documentElement;
    root.lang = locale;
    root.setAttribute('data-tg-locale', locale);
  }, [pathname, locales]);
  return null;
}

/**
 * Sets `document.title` to the entry for `data-tg-locale`. For pages rendered once for every
 * locale (the 404): React restores the hoisted `<title>` on hydration, so this runs after it.
 */
export function DocumentTitle({ titles }: { titles: Readonly<Record<string, string>> }) {
  useEffect(() => {
    const title = titles[document.documentElement.getAttribute('data-tg-locale') ?? ''];
    if (title) document.title = title;
  }, [titles]);
  return null;
}
