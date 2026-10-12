'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from '../site/copy/index.ts';

const LocaleContext = createContext<Locale>('en');

/** Tells slots that only get Makit's props (`Footer`) which locale the page is in. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

/** Renders the variant for the surrounding `LocaleProvider`, or `en` outside one. */
export function ByLocale(variants: Record<Locale, ReactNode>) {
  return variants[useContext(LocaleContext)];
}
