import { RouteLink } from '@natsuneko-laboratory/makit-runtime';
import type { ResolvedNavNode, SidebarProps } from '@natsuneko-laboratory/makit-runtime';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../site/copy/index.ts';
import { localeOf } from './locale.ts';
import { SidebarDrawer } from './SidebarDrawer.tsx';

type Leaf = Extract<ResolvedNavNode, { type: 'page' | 'link' }>;

/** The title of the page at `route`, searched depth-first. */
const titleOf = (nodes: readonly ResolvedNavNode[], route: string): string | undefined => {
  for (const node of nodes) {
    if (node.href === route) return node.title;
    if (node.type !== 'page' && node.type !== 'link') {
      const title = titleOf(node.items, route);
      if (title) return title;
    }
  }
  return undefined;
};

function Item({ node, currentRoute }: { node: Leaf | { title: string; href: string }; currentRoute: string }) {
  if ('external' in node && node.external) return <a href={node.href} target="_blank" rel="noopener noreferrer">{node.title} <ArrowUpRight size={14} aria-hidden="true" /></a>;
  return <RouteLink href={node.href} aria-current={node.href === currentRoute ? 'page' : undefined}>{node.title}</RouteLink>;
}

/**
 * A group nested in a chapter group is a package and its sub-pages (`math`, `math-noise`, …): the
 * first page sits at the group's level and the rest are indented under it.
 */
function Family({ items, currentRoute }: { items: readonly ResolvedNavNode[]; currentRoute: string }) {
  const [first, ...rest] = items;
  return <>
    {first && <Entry node={first} currentRoute={currentRoute} />}
    {rest.length > 0 && <li><ul className="nr-sidebar-children">{rest.map((node, index) => <Entry key={index} node={node} currentRoute={currentRoute} />)}</ul></li>}
  </>;
}

function Entry({ node, currentRoute }: { node: ResolvedNavNode; currentRoute: string }) {
  if (node.type === 'page' || node.type === 'link') return <li><Item node={node} currentRoute={currentRoute} /></li>;
  if (node.href) {
    return <>
      <li><Item node={{ title: node.title ?? '', href: node.href }} currentRoute={currentRoute} /></li>
      <li><ul className="nr-sidebar-children">{node.items.map((child, index) => <Entry key={index} node={child} currentRoute={currentRoute} />)}</ul></li>
    </>;
  }
  return <Family items={node.items} currentRoute={currentRoute} />;
}

/**
 * Top-level groups get a caption; loose pages between them share a plain list. A
 * section at the top is the collection's root, whose own page is already its first item, so its
 * items are listed in its place.
 */
function Groups({ nodes, currentRoute }: { nodes: readonly ResolvedNavNode[]; currentRoute: string }) {
  const blocks: ReactNode[] = [];
  let loose: ResolvedNavNode[] = [];
  const flush = () => {
    if (loose.length > 0) blocks.push(<ul key={blocks.length} className="nr-sidebar-list">{loose.map((node, index) => <Entry key={index} node={node} currentRoute={currentRoute} />)}</ul>);
    loose = [];
  };
  for (const node of nodes) {
    if (node.type === 'page' || node.type === 'link') {
      loose.push(node);
      continue;
    }
    flush();
    blocks.push(node.type === 'section'
      ? <Groups key={blocks.length} nodes={node.items} currentRoute={currentRoute} />
      : <div key={blocks.length} className="nr-sidebar-group">
        {node.title && <p id={`nr-nav-${node.id ?? blocks.length}`} className="nr-sidebar-caption">{node.href ? <Item node={{ title: node.title, href: node.href }} currentRoute={currentRoute} /> : node.title}</p>}
        <ul className="nr-sidebar-list" aria-labelledby={node.title ? `nr-nav-${node.id ?? blocks.length}` : undefined}>{node.items.map((child, index) => <Entry key={index} node={child} currentRoute={currentRoute} />)}</ul>
      </div>);
  }
  flush();
  return blocks;
}

/** Grouped documentation navigation: a sticky column from 860 px, a drawer below. */
export function Sidebar({ navigation, currentRoute }: SidebarProps) {
  if (navigation.length === 0) return null;
  const { docs } = copy(localeOf(currentRoute)).theme;
  return <aside className="nr-sidebar">
    <SidebarDrawer label={docs.chapters} title={titleOf(navigation, currentRoute) ?? docs.navigation}>
      <nav className="nr-sidebar-nav" aria-label={docs.navigation}>
        <Groups nodes={navigation} currentRoute={currentRoute} />
      </nav>
    </SidebarDrawer>
  </aside>;
}
