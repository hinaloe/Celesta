// Where a layer's JSX was written: the host node's fiber, walked up through
// the components that rendered it. Only elements the dev runtime recorded a
// position for take part, so a production-built tree yields no chain.

import { sourceOfProps } from './jsx-dev-runtime';
import type { HostNode } from './reconciler';

export interface LayerSourceEntry {
  name: string;
  file: string;
  line: number;
  column: number;
}

interface Fiber {
  return: Fiber | null;
  type: unknown;
  elementType: unknown;
  memoizedProps: unknown;
  pendingProps: unknown;
}

function typeName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') {
    const named = type as { displayName?: string; name: string };
    return named.displayName || named.name || 'Anonymous';
  }
  if (typeof type === 'object' && type !== null) {
    // `memo` and `forwardRef` wrap the component the author wrote.
    const wrapper = type as { displayName?: string; type?: unknown; render?: unknown };
    return wrapper.displayName || (wrapper.type ? typeName(wrapper.type) : wrapper.render ? typeName(wrapper.render) : 'Anonymous');
  }
  return 'Anonymous';
}

/**
 * The elements that produced `node`, nearest first: the host element itself,
 * then each component element above it, each at the position it was written.
 * `resolveFile` turns the recorded file name into the path to report.
 */
export function sourceChain(node: HostNode, resolveFile: (fileName: string) => string): LayerSourceEntry[] {
  const chain: LayerSourceEntry[] = [];
  for (let fiber = node.fiber as Fiber | null | undefined; fiber; fiber = fiber.return) {
    const source = sourceOfProps(fiber.memoizedProps ?? fiber.pendingProps);
    if (!source) continue;
    const file = resolveFile(source.fileName);
    const last = chain[chain.length - 1];
    if (last && last.file === file && last.line === source.lineNumber && last.column === source.columnNumber) continue;
    chain.push({ name: typeName(fiber.elementType ?? fiber.type), file, line: source.lineNumber, column: source.columnNumber });
  }
  return chain;
}
