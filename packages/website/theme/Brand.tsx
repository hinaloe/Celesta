import { RouteLink } from '@natsuneko-laboratory/makit-runtime';

/** The Celesta crescent; the star in its opening is the amber tally lamp. */
export function Mark() {
  return <span className="tg-mark" aria-hidden="true">
    <svg viewBox="0 0 32 32"><path d="M24.8 7.84A12 12 0 1 0 24.8 24.16 9 9 0 1 1 24.8 7.84Z" fill="currentColor" /></svg>
    <span className="tg-tally" />
  </span>;
}

export function Brand({ href, label, title = 'Celesta' }: { href: string; label: string; title?: string }) {
  return <RouteLink className="tg-brand" href={href} aria-label={label}>
    <Mark />
    <span className="tg-wordmark">{title}</span>
  </RouteLink>;
}
