import { defineStaticPageMetadata } from '@natsuneko-laboratory/makit/metadata';
import { copy, type Locale } from './copy/index.ts';
import { showcase } from './showcase-catalog.ts';

const locales: Locale[] = ['en', 'ja'];

/** Makit appends the site name to every title, so a work is "<Title> — Showcase"; its description is the gallery's. */
export function showcaseMetadata(slug: (typeof showcase)[number]['slug']) {
  const { title } = showcase.find(item => item.slug === slug)!;
  return defineStaticPageMetadata({
    title: Object.fromEntries(locales.map(locale => [locale, `${title} — ${copy(locale).showcase.label}`])) as Record<Locale, string>,
    description: Object.fromEntries(locales.map(locale => [locale, copy(locale).showcase.samples[slug].description])) as Record<Locale, string>,
    search: false,
  });
}
