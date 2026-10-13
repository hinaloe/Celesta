'use client';

import { Download } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import type { DownloadLinks, Platform } from '../../site/downloads.ts';

function detectPlatform(): Platform | null {
  const agent = navigator.userAgent;
  // iPadOS reports itself as a Mac, so check for touch as well.
  if (/iPhone|iPad|iPod|Android/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return null;
  if (/Mac/.test(agent)) return 'macOS';
  if (/Windows/.test(agent)) return 'Windows';
  return null;
}

const subscribe = () => () => {};

/** The visitor's desktop platform when Celesta has an app for it; `null` while prerendering and hydrating. */
const useVisitorPlatform = () => useSyncExternalStore(subscribe, detectPlatform, () => null);

export interface DownloadButtonProps {
  /** Resolved on the server from `CELESTA_DOWNLOAD_URL*` (`site/downloads.ts`). */
  links: DownloadLinks;
  labels: { any: string } & Record<Platform, string>;
  className?: string;
}

/** The primary download call to action, matched to the visitor's platform. */
export function DownloadButton({ links, labels, className = '' }: DownloadButtonProps) {
  const platform = useVisitorPlatform();
  return <a className={`nr-button lp-download ${className}`.trim()} href={platform ? links[platform] : links.all} data-platform={platform ?? undefined}>
    <Download size={16} strokeWidth={1.75} aria-hidden="true" />{platform ? labels[platform] : labels.any}
  </a>;
}

/** The line below a download button: the other platforms, the install guide, every release. Each variant is rendered on the server. */
export function DownloadAlternatives({ variants, className = '' }: { variants: { any: ReactNode } & Record<Platform, ReactNode>; className?: string }) {
  const platform = useVisitorPlatform();
  return <p className={`lp-alternatives ${className}`.trim()}>{variants[platform ?? 'any']}</p>;
}
