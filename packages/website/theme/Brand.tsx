import { RouteLink } from '@natsuneko-laboratory/makit-runtime';

/** The Celesta crescent. */
export function Mark() {
  return <span className="nr-mark" aria-hidden="true">
    <svg viewBox="0 0 32 32"><path d="M24.8 7.84A12 12 0 1 0 24.8 24.16 9 9 0 1 1 24.8 7.84Z" fill="currentColor" /></svg>
  </span>;
}

export function Brand({ href, label, title = 'Celesta' }: { href: string; label: string; title?: string }) {
  return <RouteLink className="nr-brand" href={href} aria-label={label}>
    <Mark />
    <span className="nr-wordmark">{title}</span>
  </RouteLink>;
}
