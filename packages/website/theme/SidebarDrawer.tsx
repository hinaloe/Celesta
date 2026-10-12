'use client';

import { useId, type ReactNode } from 'react';
import { useDisclosure } from './useDisclosure.ts';

export interface SidebarDrawerProps {
  /** Small label before the title (`Chapters`). */
  label: string;
  /** The current page's title, shown on the toggle. */
  title: string;
  children: ReactNode;
}

/**
 * Below 860 px the documentation navigation folds behind a bar that names the current page
 * (closing rules in `useDisclosure`). From 860 px CSS hides the bar and always shows the panel.
 */
export function SidebarDrawer({ label, title, children }: SidebarDrawerProps) {
  const id = useId();
  const { open, toggle, button, panel, closeOnLink } = useDisclosure();
  return <>
    <button ref={button} type="button" className="tg-drawer-button" aria-expanded={open} aria-controls={id} onClick={toggle}>
      <span className="tg-drawer-label tg-mono">{label}</span>
      <span className="tg-drawer-title">{title}</span>
      <span className="tg-drawer-icon" aria-hidden="true" />
    </button>
    <div ref={panel} id={id} className="tg-drawer-panel" data-open={open ? '' : undefined} onClick={closeOnLink}>
      {children}
    </div>
  </>;
}
