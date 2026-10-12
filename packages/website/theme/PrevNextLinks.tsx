import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import type { PrevNextLinksProps } from '@natsuneko-laboratory/makit-runtime';
import { copy } from '../site/copy/index.ts';
import { localeOf } from './locale.ts';

/** The pager under a chapter. The props carry no locale, so it comes from the links' own paths. */
export function PrevNextLinks({ prev, next }: PrevNextLinksProps) {
  const href = prev?.href ?? next?.href;
  if (!href) return null;
  const { docs } = copy(localeOf(href)).theme;
  return <nav className="tg-pager" aria-label={docs.pager}>
    {prev && <RouteLink className="tg-pager-prev" href={prev.href} rel="prev">
      <span className="tg-pager-label tg-mono"><span aria-hidden="true">← </span>{docs.previous}</span>
      <span className="tg-pager-title">{prev.title}</span>
    </RouteLink>}
    {next && <RouteLink className="tg-pager-next" href={next.href} rel="next">
      <span className="tg-pager-label tg-mono">{docs.next}<span aria-hidden="true"> →</span></span>
      <span className="tg-pager-title">{next.title}</span>
    </RouteLink>}
  </nav>;
}
