import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
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
  const { showcase: c, common } = copy(locale);
  const sample: Sample = c.samples[work.slug];
  const source = `${repository}/tree/main/examples/${work.slug}`;

  return <div className="sc">
    <section className="sc-intro nr-shell" aria-labelledby="showcase-title">
      <p className="sc-eyebrow"><RouteLink href={`/${locale}/showcase/`}><ArrowLeft size={14} aria-hidden="true" />{c.all}</RouteLink></p>
      <h1 id="showcase-title">{work.title}</h1>
      <p className="sc-lede">{sample.description}</p>
      <div className="sc-meta"><span className="nr-mono">{work.duration}</span><a href={source}>{c.credits}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
    </section>
    {'desktop' in work
      ? <section className="sc-notice nr-shell" aria-labelledby="notice-heading">
        <h2 id="notice-heading">{c.desktopHeading}</h2>
        <p>{sample.limitation}</p>
        <div className="sc-actions">
          <a className="nr-button" href={source}>{c.setup}<ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" /></a>
          <RouteLink className="nr-button-secondary" href={`/${locale}/docs/installation/`}>{c.install}</RouteLink>
        </div>
      </section>
      : <>
        <section className="sc-playground nr-shell" aria-label={common.navigation.playground}>
          <PlaygroundMount options={{ kind: 'showcase', slug: work.slug, locale }} fallback={<p className="sc-fallback">{c.metadataNoscript(children => <a href={source}>{children}</a>)}</p>} />
        </section>
        <div className="sc-edition nr-shell"><p className="sc-note">{c.editionNote} <a href={source}>{c.original} <ArrowUpRight size={14} aria-hidden="true" /></a></p></div>
      </>}
  </div>;
}
