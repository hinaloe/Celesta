'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Copy, Locale } from '../site/copy/index.ts';

/** Strings for the client parts of the docs shell, handed down so the copy catalog stays on the server. */
export type DocsLabels = Copy['theme']['docs'];

const LocaleContext = createContext<{ locale: Locale; docs?: DocsLabels }>({ locale: 'en' });

/**
 * Tells slots that only get Makit's props which locale the page is in: the `Footer`, and on docs
 * pages the client `TableOfContents` (with `docs`, that locale's labels).
 */
export function LocaleProvider({ locale, docs, children }: { locale: Locale; docs?: DocsLabels; children: ReactNode }) {
  return <LocaleContext value={{ locale, docs }}>{children}</LocaleContext>;
}

/** The surrounding `LocaleProvider`'s docs labels, if it has them. */
export const useDocsLabels = (): DocsLabels | undefined => useContext(LocaleContext).docs;

/** Renders the variant for the surrounding `LocaleProvider`, or `en` outside one. */
export function ByLocale(variants: Record<Locale, ReactNode>) {
  return variants[useContext(LocaleContext).locale];
}
