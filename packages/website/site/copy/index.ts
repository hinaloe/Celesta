import { en } from './en.ts';
import { ja } from './ja.ts';

export type { Slot } from './en.ts';

export type Locale = 'en' | 'ja';
export type Copy = typeof en;

const catalogs: Record<Locale, Copy> = { en, ja };

export const isLocale = (value: string): value is Locale => value === 'en' || value === 'ja';

export const copy = (locale: Locale): Copy => catalogs[locale];
