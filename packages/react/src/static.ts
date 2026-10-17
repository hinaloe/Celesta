// The layers of each `<Static>` subtree, kept between frames, and which of
// them the Rust bridge has received. A frame asked for with `statics` refers
// to a subtree by key; it carries the subtree's layers only until a frame
// that carried them is known to be decoded on the Rust side.

import { type HostNode, hostRevision } from './reconciler';
import type { FontFallbackMode, Layer, ShaderSource } from './scene';

/** What a `<Static>`'s cached layers depend on besides its subtree. */
export interface StaticContext {
  path: string;
  lang: string | undefined;
  fontFallback: FontFallbackMode | undefined;
  idPrefix: string;
  compact: boolean;
}

interface Entry extends StaticContext {
  key: number;
  layers: Layer[];
  /** The custom shaders the layers use, listed again on every frame. */
  shaders: ShaderSource[];
  /** The `hostRevision()` when the layers were walked. */
  walkedAt: number;
}

/** What a frame asked for with `statics` tells the bridge. */
export interface StaticsFrame {
  seq: number;
  /**
   * A list rather than an object keyed by number: V8 holds such keys as
   * indexed elements, which send the whole frame's JSON.stringify down its
   * slow path.
   */
  defined: { key: number; layers: Layer[] }[];
  dropped: number[];
}

export class StaticSubtrees {
  private readonly entries = new Map<HostNode, Entry>();
  private readonly byKey = new Map<number, Entry>();
  /** The `seq` of the first frame that carried each key's layers. */
  private readonly firstSent = new Map<number, number>();
  /** Keys to drop, kept until a frame asked for with `statics` sends them. */
  private dropped: number[] = [];
  private nextKey = 1;
  private seq = 0;

  /** `node`'s cached layers, if nothing they depend on changed. */
  lookup(node: HostNode, context: StaticContext): Entry | undefined {
    const entry = this.entries.get(node);
    if (
      entry &&
      node.changedAt <= entry.walkedAt &&
      entry.path === context.path &&
      entry.lang === context.lang &&
      entry.fontFallback === context.fontFallback &&
      entry.idPrefix === context.idPrefix &&
      entry.compact === context.compact
    ) {
      return entry;
    }
    return undefined;
  }

  /** Caches `layers` for `node` under a new key, dropping its old one. */
  store(
    node: HostNode,
    walked: { layers: Layer[]; shaders: ShaderSource[] },
    context: StaticContext,
  ): Entry {
    const previous = this.entries.get(node);
    if (previous) this.forget(previous);
    const entry: Entry = { ...context, key: this.nextKey++, ...walked, walkedAt: hostRevision() };
    this.entries.set(node, entry);
    this.byKey.set(entry.key, entry);
    return entry;
  }

  /** Drops the subtrees whose host nodes are no longer in `root`. */
  sweep(root: readonly HostNode[]): void {
    for (const [node, entry] of this.entries) {
      let top = node;
      while (top.parent) top = top.parent;
      if (!root.includes(top)) {
        this.entries.delete(node);
        this.forget(entry);
      }
    }
  }

  /**
   * Numbers a frame asked for with `statics` and lists the layers it must
   * carry: those of every key it refers to that no frame up to `decoded`
   * carried.
   */
  frame(referenced: ReadonlySet<number>, decoded: number): StaticsFrame {
    const seq = ++this.seq;
    const defined: StaticsFrame['defined'] = [];
    for (const key of referenced) {
      const first = this.firstSent.get(key);
      if (first === undefined || first > decoded) {
        defined.push({ key, layers: this.byKey.get(key)!.layers });
        if (first === undefined) this.firstSent.set(key, seq);
      }
    }
    const dropped = this.dropped;
    this.dropped = [];
    return { seq, defined, dropped };
  }

  private forget(entry: Entry): void {
    this.byKey.delete(entry.key);
    this.firstSent.delete(entry.key);
    this.dropped.push(entry.key);
  }
}
