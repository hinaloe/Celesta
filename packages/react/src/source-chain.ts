// Where a layer's JSX was written: the host node's fiber, walked up through
// the components that rendered it. Only elements the dev runtime recorded a
// position for take part, so a production-built tree yields no chain.

import { CompositionRuntimeContext, runtimeFrame } from './hooks';
import { sourceOfProps } from './jsx-dev-runtime';
import type { HostNode } from './reconciler';

export interface LayerSourceEntry {
  name: string;
  file: string;
  line: number;
  column: number;
  /** A Celesta layer component (`<Rect>`, `<Group>`, ...) or anything else. */
  kind: 'primitive' | 'component';
  /** The layer a primitive entry produced, when it can be told. */
  layerId?: string;
}

/** The transform props a primitive element received, finite numbers only. */
export interface ReceivedProps {
  x?: number;
  y?: number;
  rotation?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface LayerSourceReport {
  chain: LayerSourceEntry[];
  // The three fields below are present only when the chain is not empty.
  /**
   * The frame `useCurrentFrame()` reports in the component that wrote the
   * innermost primitive's JSX (its owner), which an `interpolate(frame, …)`
   * written there reads; not the frame at the element, which a `<Sequence>`
   * between the two shifts.
   */
  localFrame?: number;
  /**
   * Present (true) when the owner could not be told for sure and a frame
   * provider with another frame lies above the presumed owner: the
   * element may have been created by a function passed down from there.
   */
  frameUncertain?: true;
  props?: ReceivedProps;
  /** How many layers this element's JSX produced in the frame. */
  renderCount?: number;
}

const primitives = new WeakSet<object>();
const transparent = new WeakSet<object>();

/**
 * Marks a component as a Celesta layer primitive, so a source chain can tell
 * the author's own `Rect` from `<Rect>`. Unwraps `forwardRef` and `memo`.
 */
export function markPrimitive(component: unknown): void {
  const target = unwrap(component);
  if (target !== null) primitives.add(target);
}

/**
 * Marks a Celesta component that draws JSX written by its caller
 * (`<Sequence>`, `<FreezeFrame>`, `<MotionBlur>`'s moments, ...): it never
 * owns that JSX, so the frame an `interpolate(frame, …)` reads is looked up
 * above it.
 */
export function markTransparent(component: unknown): void {
  const target = unwrap(component);
  if (target !== null) transparent.add(target);
}

function unwrap(component: unknown): object | null {
  if (typeof component === 'function') return component;
  if (typeof component !== 'object' || component === null) return null;
  const wrapper = component as { type?: unknown; render?: unknown };
  return unwrap(wrapper.render ?? wrapper.type) ?? component;
}

function isPrimitive(type: unknown): boolean {
  const target = unwrap(type);
  return target !== null && primitives.has(target);
}

interface Fiber {
  return: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  stateNode?: unknown;
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
export function sourceChain(
  node: HostNode,
  resolveFile: (fileName: string) => string,
  layerIdOf?: (node: HostNode) => string | undefined,
): LayerSourceEntry[] {
  return sourceFibers(node, resolveFile, layerIdOf).map(({ entry }) => entry);
}

function sourceFibers(
  node: HostNode,
  resolveFile: (fileName: string) => string,
  layerIdOf?: (node: HostNode) => string | undefined,
): { entry: LayerSourceEntry; fiber: Fiber }[] {
  const chain: { entry: LayerSourceEntry; fiber: Fiber }[] = [];
  for (let fiber = node.fiber as Fiber | null | undefined; fiber; fiber = fiber.return) {
    const source = sourceOfProps(fiber.memoizedProps ?? fiber.pendingProps);
    if (!source) continue;
    const file = resolveFile(source.fileName);
    const last = chain[chain.length - 1]?.entry;
    if (last && last.file === file && last.line === source.lineNumber && last.column === source.columnNumber) continue;
    const type = fiber.elementType ?? fiber.type;
    const entry: LayerSourceEntry = {
      name: typeName(type),
      file,
      line: source.lineNumber,
      column: source.columnNumber,
      kind: isPrimitive(type) ? 'primitive' : 'component',
    };
    if (entry.kind === 'primitive') {
      const host = firstHostNode(fiber);
      const id = host ? layerIdOf?.(host) : undefined;
      if (id !== undefined) entry.layerId = id;
    }
    chain.push({ entry, fiber });
  }
  return chain;
}

/** The first host node at or below `fiber`, depth first. */
function firstHostNode(fiber: Fiber): HostNode | null {
  if (typeof fiber.type === 'string') return (fiber.stateNode as HostNode | undefined) ?? null;
  for (let child = fiber.child ?? null; child; child = child.sibling ?? null) {
    const found = firstHostNode(child);
    if (found) return found;
  }
  return null;
}

const TRANSFORM_PROPS = ['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY'] as const;

/**
 * `sourceChain` plus what the editor needs to write a transform back into
 * the source: the frame local to the layer's element, the transform props
 * its innermost primitive received, and how many layers that element
 * produced. `layerNodes` is the frame's layer id -> node map.
 */
export function layerSourceReport(
  node: HostNode,
  layerNodes: ReadonlyMap<string, HostNode>,
  resolveFile: (fileName: string) => string,
): LayerSourceReport {
  const ids = new Map<HostNode, string>();
  for (const [id, hostNode] of layerNodes) if (!ids.has(hostNode)) ids.set(hostNode, id);
  const found = sourceFibers(node, resolveFile, (hostNode) => ids.get(hostNode));
  const chain = found.map(({ entry }) => entry);
  if (chain.length === 0) return { chain };

  const primitive = found.find(({ entry }) => entry.kind === 'primitive');
  const owner = ownerFrame(primitive?.fiber ?? (node.fiber as Fiber | null | undefined) ?? null);

  const props: ReceivedProps = {};
  const received = (primitive?.fiber.memoizedProps ?? primitive?.fiber.pendingProps ?? {}) as Record<string, unknown>;
  for (const key of TRANSFORM_PROPS) {
    const value = received[key];
    if (typeof value === 'number' && Number.isFinite(value)) props[key] = value;
  }

  let renderCount = 0;
  const innermost = chain[0];
  const seen = new Set<HostNode>();
  for (const other of layerNodes.values()) {
    if (seen.has(other)) continue;
    seen.add(other);
    const first = sourceChain(other, resolveFile)[0];
    if (first && first.file === innermost.file && first.line === innermost.line && first.column === innermost.column) {
      renderCount++;
    }
  }
  return {
    chain,
    localFrame: owner.frame,
    ...(owner.uncertain ? { frameUncertain: true as const } : {}),
    props,
    renderCount,
  };
}

type RuntimeValue = { time: { value: number; timescale: number }; fps: number; frameOffset?: number };

/** The frame a `CompositionRuntimeContext` provider fiber hands down, if it is one. */
function providedFrame(fiber: Fiber): number | undefined {
  // React 19 makes the context its own provider; 18 wraps it.
  const type = fiber.type as { _context?: unknown } | null;
  if (!type || typeof type !== 'object') return undefined;
  if (type !== (CompositionRuntimeContext as unknown) && type._context !== CompositionRuntimeContext) return undefined;
  const value = (fiber.memoizedProps as { value?: RuntimeValue | null } | null)?.value;
  return value ? runtimeFrame(value.time, value.fps, value.frameOffset) : undefined;
}

/** The frame `useCurrentFrame()` reports in a component at `fiber`. */
function frameAt(fiber: Fiber | null): number | undefined {
  for (let above = fiber?.return ?? null; above; above = above.return) {
    const frame = providedFrame(above);
    if (frame !== undefined) return frame;
  }
  return undefined;
}

/** A function component (or `memo`/`forwardRef` of one) the author wrote. */
function isAuthorComponent(fiber: Fiber): boolean {
  const type = fiber.elementType ?? fiber.type;
  const target = unwrap(type);
  if (target === null || typeof target !== 'function') return false;
  return !primitives.has(target) && !transparent.has(target);
}

/**
 * Whether `props` holds the element whose props object is `target`: as a
 * prop, in `children`, or anywhere inside elements and arrays passed down.
 */
function passesDown(props: unknown, target: object): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [props];
  while (stack.length > 0 && seen.size < 10_000) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    if (value === target) return true;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if ('$$typeof' in value) {
      stack.push((value as { props?: unknown }).props);
    } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
      stack.push(...Object.values(value));
    }
  }
  return false;
}

function hasFunctionProp(props: unknown): boolean {
  if (typeof props !== 'object' || props === null) return false;
  return Object.values(props).some((value) => typeof value === 'function');
}

/**
 * The frame the component that wrote `primitive`'s JSX (its owner) reads.
 * React keeps no owner outside development builds, so the owner is the
 * nearest component above the element that the author wrote, did not mark
 * as drawing its caller's JSX, and did not receive the element through its
 * props. A component with a function prop may have called a function its
 * caller wrote instead; the frame is then uncertain when any frame provider
 * above it hands down another frame.
 */
function ownerFrame(primitive: Fiber | null): { frame: number; uncertain: boolean } {
  const atElement = frameAt(primitive) ?? 0;
  if (!primitive) return { frame: atElement, uncertain: false };
  const target = (primitive.memoizedProps ?? primitive.pendingProps) as object | null;
  for (let fiber = primitive.return; fiber; fiber = fiber.return) {
    if (!isAuthorComponent(fiber)) continue;
    const props = fiber.memoizedProps ?? fiber.pendingProps;
    if (target && passesDown(props, target)) continue;
    const frame = frameAt(fiber);
    // Outside every provider (an entry's root, say), no frame can be read.
    if (frame === undefined) return { frame: atElement, uncertain: false };
    let uncertain = false;
    if (hasFunctionProp(props)) {
      for (let above = fiber.return; above && !uncertain; above = above.return) {
        const other = providedFrame(above);
        uncertain = other !== undefined && other !== frame;
      }
    }
    return { frame, uncertain };
  }
  return { frame: atElement, uncertain: false };
}
