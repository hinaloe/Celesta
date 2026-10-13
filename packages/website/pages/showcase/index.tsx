import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import type { StaticPageComponentProps } from '@natsuneko-laboratory/makit-runtime';
import { ArrowRight } from 'lucide-react';
import { copy, isLocale } from '../../site/copy/index.ts';
import { showcase } from '../../site/showcase-catalog.ts';
import '../_components/showcase.css';

/** The gallery: a poster card for every composition, in catalog order. */
export default function Gallery({ locale: urlLocale }: StaticPageComponentProps) {
  const locale = isLocale(urlLocale) ? urlLocale : 'en';
  const c = copy(locale).showcase;

  return <div className="sc">
    <section className="sc-intro nr-shell" aria-labelledby="showcase-title">
      <p className="sc-eyebrow">{c.madeWith}</p>
      <h1 id="showcase-title">{c.heading}</h1>
      <p className="sc-lede">{c.intro}</p>
    </section>
    <section className="sc-gallery nr-shell" aria-label={c.compositions}>
      <p className="sc-note">{c.note}</p>
      <ul className="sc-grid">{showcase.map((work, index) => <li key={work.slug}>
        <RouteLink className="sc-card" href={`/${locale}/showcase/${work.slug}/`}>
          <div className="sc-poster">{'poster' in work
            ? <img src={`/showcase/${work.slug}.jpg`} alt="" loading="lazy" width="1920" height="1080" />
            : <span aria-hidden="true">{work.title}</span>}</div>
          <div className="sc-card-meta">
            <span className="nr-mono">{String(index + 1).padStart(2, '0')} · {work.duration}</span>
            {'desktop' in work ? <span data-kind="desktop">{c.desktop}</span> : <span data-kind="run">{c.run}<ArrowRight size={14} aria-hidden="true" /></span>}
          </div>
          <h2>{work.title}</h2>
          <p>{c.samples[work.slug].description}</p>
        </RouteLink>
      </li>)}</ul>
    </section>
  </div>;
}
