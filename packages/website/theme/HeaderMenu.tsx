'use client';

import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { useDisclosure } from './useDisclosure.ts';

export interface NavLink {
  href: string;
  label: string;
  external?: boolean;
  /** Marked current on every page below `href`. */
  section?: boolean;
}

export interface HeaderMenuProps {
  links: readonly NavLink[];
  download: { href: string; label: string };
  labels: { menu: string; close: string; main: string };
}

const trim = (path: string) => path.replace(/\/$/, '');

/** `page` on the section's own page, `true` below it. */
const currentOf = (pathname: string, href: string) => {
  const [path, base] = [trim(pathname), trim(href)];
  return path === base ? 'page' : path.startsWith(`${base}/`) ? 'true' : undefined;
};

/**
 * The header navigation. From 860 px it sits inline; below, it folds behind a disclosure button
 * (closing rules in `useDisclosure`).
 */
export function HeaderMenu({ links, download, labels }: HeaderMenuProps) {
  const id = useId();
  const pathname = usePathname();
  const { open, toggle, button, panel, closeOnLink } = useDisclosure();

  return <>
    <button ref={button} type="button" className="tg-menu-button" aria-expanded={open} aria-controls={id} onClick={toggle}>
      <span className="tg-menu-icon" aria-hidden="true" /><span className="tg-menu-label">{open ? labels.close : labels.menu}</span>
    </button>
    <div ref={panel} id={id} className="tg-nav-panel" data-open={open ? '' : undefined} onClick={closeOnLink}>
      <nav className="tg-nav" aria-label={labels.main}>
        {links.map((link) => link.external
          ? <a key={link.href} href={link.href}>{link.label} <span aria-hidden="true">↗</span></a>
          : <RouteLink key={link.href} href={link.href} aria-current={link.section ? currentOf(pathname, link.href) : undefined}>{link.label}</RouteLink>)}
      </nav>
      <a className="tg-button tg-nav-download" href={download.href}>{download.label} <span aria-hidden="true">↓</span></a>
    </div>
  </>;
}
