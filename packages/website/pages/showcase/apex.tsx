import type { StaticPageComponentProps } from '@natsuneko-laboratory/makit-runtime';
import { isLocale } from '../../site/copy/index.ts';
import { ShowcaseEntry } from '../_components/ShowcaseEntry.tsx';

export default function Page({ locale: urlLocale }: StaticPageComponentProps) {
  const locale = isLocale(urlLocale) ? urlLocale : 'en';
  return <ShowcaseEntry slug="apex" locale={locale} />;
}
