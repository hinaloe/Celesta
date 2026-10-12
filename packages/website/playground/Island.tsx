import { useEffect, useState } from 'react';
import { showcase } from '../site/showcase-catalog.ts';
import type { PlaygroundCopy } from './copy.ts';
import { Playground } from './Playground.tsx';
import { loadShowcase } from './showcase-sources.ts';

/** A showcase work's sources, loaded on demand, then the playground over them; a failed load can be retried. */
export function ShowcasePlayground({ slug, copy: c }: { slug: string; copy: PlaygroundCopy }) {
  const sample = showcase.find(item => item.slug === slug);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');
  const [loadingAttempt, setLoadingAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setError('');
    void loadShowcase(slug).then(result => { if (current) setFiles(result); }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [slug, loadingAttempt]);

  return files ? <Playground key={slug} copy={c} initialFiles={files} entry="film.tsx" initialFrame={sample && 'frame' in sample ? sample.frame : 0} baseURL={new URL(`/showcase-assets/examples/${slug}/`, window.location.origin).href} silent title={c.showcase.editTitle} />
    : <div className="pg-loading" role="status">{error ? <>{error} <button type="button" className="pg-link-button" onClick={() => setLoadingAttempt(attempt => attempt + 1)}>{c.showcase.retry}</button></> : c.showcase.loading}</div>;
}
