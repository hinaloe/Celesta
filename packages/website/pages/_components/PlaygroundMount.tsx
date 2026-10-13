'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Locale } from '../../site/copy/index.ts';

/** What `mountPlayground` (playground/main.ts) renders. */
export type PlaygroundOptions = { kind: 'home'; locale: Locale } | { kind: 'showcase'; slug: string; locale: Locale };
type Island = { mountPlayground(element: HTMLElement, options: PlaygroundOptions): () => void };
/** `public/_playground/manifest.json`, written by the island build (playground/vite.config.ts). */
type Manifest = { entry: string; css: string[] };

/** One island per page load: the manifest is fetched once and the module stays cached for later mounts. */
let island: Promise<Island> | undefined;

function stylesheet(href: string): Promise<void> {
  return new Promise(resolve => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`);
    if (link?.sheet) { resolve(); return; }
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.append(link);
    }
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

function loadIsland(): Promise<Island> {
  island ??= fetch('/_playground/manifest.json')
    .then(response => {
      if (!response.ok) throw new Error(`The playground manifest could not be loaded (${response.status}).`);
      return response.json() as Promise<Manifest>;
    })
    // The island is a separate Vite build; the bundler must leave this runtime URL to the browser.
    .then(async manifest => (await Promise.all([import(/* webpackIgnore: true */ manifest.entry), ...manifest.css.map(stylesheet)]))[0] as Island);
  island.catch(() => { island = undefined; });
  return island;
}

const placeholder: CSSProperties = {
  minHeight: 720,
  border: '1px solid var(--nr-line)',
  borderRadius: 8,
  background: 'var(--nr-panel)',
};

/**
 * The browser playground. Renders a placeholder sized like it (with `fallback` for visitors without
 * JavaScript), then loads the island and mounts it; unmounting — including client-side navigation
 * away — unmounts the island, which terminates its workers and disposes its editor models.
 */
export function PlaygroundMount({ options, fallback }: { options: PlaygroundOptions; fallback?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const key = JSON.stringify(options);

  useEffect(() => {
    let active = true;
    let unmount: (() => void) | undefined;
    setState('loading');
    loadIsland().then(({ mountPlayground }) => {
      if (!active || !host.current) return;
      unmount = mountPlayground(host.current, JSON.parse(key) as PlaygroundOptions);
      setState('ready');
    }).catch(error => {
      if (!active) return;
      console.error(error);
      setState('failed');
    });
    return () => { active = false; unmount?.(); };
  }, [key]);

  return <div className="pg-mount" data-state={state} style={state === 'loading' ? placeholder : undefined}>
    <noscript>{fallback}</noscript>
    {state === 'failed' && fallback}
    <div ref={host} />
  </div>;
}
