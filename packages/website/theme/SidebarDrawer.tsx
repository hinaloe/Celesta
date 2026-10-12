'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface SidebarDrawerProps {
  /** Small label before the title (`Chapters`). */
  label: string;
  /** The current page's title, shown on the toggle. */
  title: string;
  children: ReactNode;
}

/**
 * Below 860 px the documentation navigation folds behind a bar that names the current page. The
 * panel closes on Escape (focus returns to the bar), on a link, on a click outside, and on
 * navigation. From 860 px CSS hides the bar and always shows the panel as the sidebar.
 */
export function SidebarDrawer({ label, title, children }: SidebarDrawerProps) {
  const id = useId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return <>
    <button ref={button} type="button" className="tg-drawer-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className="tg-drawer-label tg-mono">{label}</span>
      <span className="tg-drawer-title">{title}</span>
      <span className="tg-drawer-icon" aria-hidden="true" />
    </button>
    <div ref={panel} id={id} className="tg-drawer-panel" data-open={open ? '' : undefined} onClick={(event) => (event.target as Element).closest('a') && setOpen(false)}>
      {children}
    </div>
  </>;
}
