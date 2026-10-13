import type { PageHeaderProps } from '@natsuneko-laboratory/makit-runtime';

/** The chapter title and its one-line description. */
export function PageHeader({ page }: PageHeaderProps) {
  return <header className="nr-page-header">
    <h1>{page.title}</h1>
    {page.description && <p>{page.description}</p>}
  </header>;
}
