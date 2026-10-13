'use client';

import type { TableOfContentsProps } from '@natsuneko-laboratory/makit-runtime';
import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { useDocsLabels } from './LocaleContext.tsx';

/** A heading counts as current once its top passes this line (header plus some air). */
const activationLine = 112;

/**
 * "On this page", with its label from the docs page's `LocaleProvider`. The current section carries
 * `aria-current="location"`; `actions` (the page actions, built by `DocsPage`) render below.
 */
export function TableOfContents({ headings, minDepth, maxDepth, actions }: TableOfContentsProps) {
  const id = useId();
  const labels = useDocsLabels();
  const visible = useMemo(() => headings.filter((heading) => heading.id && heading.depth >= minDepth && heading.depth <= maxDepth), [headings, minDepth, maxDepth]);
  const [activeId, setActiveId] = useState(visible[0]?.id);

  useEffect(() => {
    if (visible.length === 0) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current = visible[0]?.id;
        for (const heading of visible) {
          const top = document.getElementById(heading.id)?.getBoundingClientRect().top;
          if (top === undefined) continue;
          if (top > activationLine) break;
          current = heading.id;
        }
        setActiveId(current);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('hashchange', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('hashchange', update);
      window.removeEventListener('resize', update);
    };
  }, [visible]);

  if (visible.length === 0) return null;
  return <aside className="nr-toc">
    {labels && <p id={id} className="nr-toc-title nr-mono">{labels.onThisPage}</p>}
    <nav aria-labelledby={labels ? id : undefined}>
      <ul className="nr-toc-list">
        {visible.map((heading) => <li key={heading.id} style={{ '--nr-toc-level': heading.depth - minDepth } as CSSProperties}>
          <a href={`#${heading.id}`} aria-current={heading.id === activeId ? 'location' : undefined}>{heading.text}</a>
        </li>)}
      </ul>
    </nav>
    {actions && <div className="nr-toc-actions">{actions}</div>}
  </aside>;
}
