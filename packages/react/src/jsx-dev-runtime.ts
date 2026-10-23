// `@celesta/react/jsx-dev-runtime`: the editor preview routes esbuild's
// `jsxDEV` calls here. Elements are the ones `react/jsx-runtime` builds; the
// position each was written at is kept on the side, keyed by the element's
// props, so a component never sees an extra prop. Fibers carry those props, so
// `sourceOfProps` answers where a rendered element came from.

import { createContext, use } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import type { Key, ReactElement } from 'react';

export interface SourcePosition {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * A value the editor's drag preview gives the prop `prop` of every element
 * written at `file:line:column` (an absolute path; 1-based, as reported in a
 * layer source chain) for one frame, in place of the written one.
 */
export interface PropOverride {
  file: string;
  line: number;
  column: number;
  prop: string;
  value: number;
}

const positions = new WeakMap<object, SourcePosition>();

/** The overrides of the frame being rendered, by `line:column`; `null` between frames and without any. */
let overrides: Map<string, PropOverride[]> | null = null;
let resolveFile: (fileName: string) => string = (fileName) => fileName;
/** `resolveFile`'s answers this frame. */
const resolvedFiles = new Map<string, string>();

/**
 * Provided above the entry with a new value whenever the overrides change: a
 * component that created an element while overrides were set renders again
 * then, even a `memo` one whose props did not change.
 */
export const PropOverridesContext = createContext<object | null>(null);

export { Fragment };

export function jsxDEV(
  type: unknown,
  props: Record<string, unknown>,
  key: Key | undefined,
  isStaticChildren: boolean,
  source?: SourcePosition,
  _self?: unknown,
): ReactElement {
  const elementProps = overrides !== null && source ? overridden(props, source) : props;
  const element = (isStaticChildren ? jsxs : jsx)(type as never, elementProps, key);
  if (source) positions.set(element.props as object, source);
  return element;
}

/** `props` with the overrides for `source`, subscribing the rendering component to later ones. */
function overridden(props: Record<string, unknown>, source: SourcePosition): Record<string, unknown> {
  try {
    use(PropOverridesContext);
  } catch {
    // Not called while a component renders (an effect, say): nothing to subscribe.
  }
  const matches = overrides?.get(`${source.lineNumber}:${source.columnNumber}`);
  if (!matches) return props;
  let file = resolvedFiles.get(source.fileName);
  if (file === undefined) {
    file = resolveFile(source.fileName);
    resolvedFiles.set(source.fileName, file);
  }
  let result = props;
  for (const { file: target, prop, value } of matches) {
    if (target === file && !Object.is(result[prop], value)) {
      if (result === props) result = { ...props };
      result[prop] = value;
    }
  }
  return result;
}

/**
 * Sets the overrides elements are created with until `clearPropOverrides`.
 * `resolve` turns a recorded file name into the absolute path overrides name.
 */
export function setPropOverrides(list: readonly PropOverride[], resolve: (fileName: string) => string): void {
  resolvedFiles.clear();
  resolveFile = resolve;
  overrides = new Map();
  for (const entry of list) {
    const position = `${entry.line}:${entry.column}`;
    const at = overrides.get(position);
    if (at) at.push(entry);
    else overrides.set(position, [entry]);
  }
}

export function clearPropOverrides(): void {
  overrides = null;
}

/** Whether the frame being rendered has prop overrides. */
export function propOverridesSet(): boolean {
  return overrides !== null;
}

export function sourceOfProps(props: unknown): SourcePosition | undefined {
  return typeof props === 'object' && props !== null ? positions.get(props) : undefined;
}

/**
 * Gives the props object `to` the position recorded for `from`, if any: for a
 * component that renders the element it was handed as another one
 * (`<Series.Sequence>` as a `<Sequence>`), so that one points at the JSX.
 */
export function copySourcePosition(from: object, to: object): void {
  const source = positions.get(from);
  if (source) positions.set(to, source);
}
