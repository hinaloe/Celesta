import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Locale } from '../site/copy/index.ts';
import { playgroundCopy } from './copy.ts';
import { ShowcasePlayground } from './Island.tsx';
import { Playground } from './Playground.tsx';
import './playground.css';

export type PlaygroundOptions = { kind: 'home'; locale: Locale } | { kind: 'showcase'; slug: string; locale: Locale };

/**
 * Renders the playground into `element` with its own React root. The returned cleanup unmounts
 * it, which terminates the composition worker, aborts an export, and disposes the Monaco models.
 */
export function mountPlayground(element: HTMLElement, options: PlaygroundOptions): () => void {
  const copy = playgroundCopy(options.locale);
  const root = createRoot(element);
  root.render(options.kind === 'showcase' ? createElement(ShowcasePlayground, { slug: options.slug, copy }) : createElement(Playground, { copy }));
  return () => root.unmount();
}
