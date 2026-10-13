import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { PrevNextLinksProps } from '@natsuneko-laboratory/makit-runtime';
import { copy } from '../site/copy/index.ts';
import { localeOf } from './locale.ts';

/** The pager under a chapter. The props carry no locale, so it comes from the links' own paths. */
export function PrevNextLinks({ prev, next }: PrevNextLinksProps) {
  const href = prev?.href ?? next?.href;
  if (!href) return null;
  const { docs } = copy(localeOf(href)).theme;
  return <nav className="nr-pager" aria-label={docs.pager}>
    {prev && <RouteLink className="nr-pager-prev" href={prev.href} rel="prev">
      <span className="nr-pager-label"><ArrowLeft size={14} aria-hidden="true" />{docs.previous}</span>
      <span className="nr-pager-title">{prev.title}</span>
    </RouteLink>}
    {next && <RouteLink className="nr-pager-next" href={next.href} rel="next">
      <span className="nr-pager-label">{docs.next}<ArrowRight size={14} aria-hidden="true" /></span>
      <span className="nr-pager-title">{next.title}</span>
    </RouteLink>}
  </nav>;
}
