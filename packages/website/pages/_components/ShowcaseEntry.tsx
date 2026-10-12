import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import { copy, type Locale } from '../../site/copy/index.ts';
import { repository } from '../../site/links.ts';
import { showcase } from '../../site/showcase-catalog.ts';
import { PlaygroundMount } from './PlaygroundMount.tsx';
import './showcase.css';

type Sample = { description: string; limitation?: string };

/** One showcase work: intro and meta, then the editable playground (browser-ready) or the desktop notice. */
export function ShowcaseEntry({ slug, locale }: { slug: string; locale: Locale }) {
  const work = showcase.find(item => item.slug === slug);
  if (!work) throw new Error(`Unknown showcase work: ${slug}`);
  const c = copy(locale).showcase;
  const sample: Sample = c.samples[work.slug];
  const source = `${repository}/tree/main/examples/${work.slug}`;

  return <div className="sc">
    <section className="sc-intro tg-shell" aria-labelledby="showcase-title">
      <p className="sc-eyebrow tg-mono"><RouteLink href={`/${locale}/showcase/`}>{c.all}</RouteLink></p>
      <h1 id="showcase-title">{work.title}</h1>
      <p className="sc-lede">{sample.description}</p>
      <div className="sc-meta tg-mono"><span>{work.duration}</span><a href={source}>{c.credits}</a></div>
    </section>
    {'desktop' in work
      ? <section className="sc-notice tg-shell" aria-labelledby="notice-heading">
        <h2 id="notice-heading">{c.desktopHeading}</h2>
        <p>{sample.limitation}</p>
        <div className="sc-actions">
          <a className="tg-button" href={source}>{c.setup}</a>
          <RouteLink className="tg-button-secondary" href={`/${locale}/docs/installation/`}>{c.install}</RouteLink>
        </div>
      </section>
      : <>
        <section className="sc-playground tg-shell" aria-labelledby="playground-heading">
          <PlaygroundMount options={{ kind: 'showcase', slug: work.slug, locale }} fallback={<p className="sc-fallback">{c.metadataNoscript(children => <a href={source}>{children}</a>)}</p>} />
        </section>
        <div className="sc-edition tg-shell"><p className="sc-note">{c.editionNote} <a href={source}>{c.original}</a></p></div>
      </>}
  </div>;
}
