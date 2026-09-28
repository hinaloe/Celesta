// A minimal react-reconciler host config. The "DOM" here is a plain tree of
// {type, props, children} instances — there is no real host platform, just
// data collected for render.ts to walk into a Scene. Mutation mode is used
// because it is the simplest mode to implement correctly; this renderer is
// not performance-sensitive (one composition, re-rendered once per exported
// frame, not sixty times a second against a live display).

import Reconciler from 'react-reconciler';
import { DefaultEventPriority, LegacyRoot } from 'react-reconciler/constants';

export interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
}

export interface RootContainer {
  children: HostNode[];
}

type NoTimeout = -1;
const NO_TIMEOUT: NoTimeout = -1;
const NO_CONTEXT = {};

function removeChild(children: HostNode[], child: HostNode): void {
  const index = children.indexOf(child);
  if (index !== -1) {
    children.splice(index, 1);
  }
}

function appendChild(children: HostNode[], child: HostNode): void {
  removeChild(children, child);
  children.push(child);
}

function insertBefore(children: HostNode[], child: HostNode, beforeChild: HostNode): void {
  removeChild(children, child);
  const index = children.indexOf(beforeChild);
  children.splice(index === -1 ? children.length : index, 0, child);
}

const hostConfig: Reconciler.HostConfig<
  string,
  Record<string, unknown>,
  RootContainer,
  HostNode,
  never,
  never,
  never,
  HostNode,
  typeof NO_CONTEXT,
  Record<string, unknown>,
  never,
  ReturnType<typeof setTimeout>,
  NoTimeout
> = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: NO_TIMEOUT,

  getRootHostContext: () => NO_CONTEXT,
  getChildHostContext: (parentHostContext) => parentHostContext,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},

  // Text content stays on the host props instead of becoming a separate
  // instance, so render.ts can read it back with `extractText`.
  shouldSetTextContent: (type) => type === 'text',
  createTextInstance: () => {
    throw new Error(
      'bare text is only supported inside <Text>; other elements only accept element children',
    );
  },

  createInstance(type, props) {
    return { type, props, children: [] };
  },
  appendInitialChild(parent, child) {
    parent.children.push(child);
  },
  finalizeInitialChildren: () => false,

  // React also calls these to move a child that is already mounted (a keyed
  // list reordered between frames) and expects DOM semantics: the child
  // leaves its old position. Inserting it without removing it first leaves a
  // duplicate behind on every move, so a list re-sorted each frame grows
  // without bound and its layers are drawn several times over.
  appendChildToContainer(container, child) {
    appendChild(container.children, child);
  },
  appendChild(parent, child) {
    appendChild(parent.children, child);
  },
  insertBefore(parent, child, beforeChild) {
    insertBefore(parent.children, child, beforeChild);
  },
  insertInContainerBefore(container, child, beforeChild) {
    insertBefore(container.children, child, beforeChild);
  },
  removeChild(parent, child) {
    removeChild(parent.children, child);
  },
  removeChildFromContainer(container, child) {
    removeChild(container.children, child);
  },
  clearContainer(container) {
    container.children = [];
  },

  prepareUpdate: () => ({}),
  commitUpdate(instance, _updatePayload, _type, _oldProps, newProps) {
    instance.props = newProps;
  },

  getPublicInstance: (instance) => instance,
  preparePortalMount: () => {},
  detachDeletedInstance: () => {},

  // Event/DevTools integration this renderer has no use for (there is no
  // real host platform to dispatch DOM-style events against), but the
  // @types/react-reconciler 0.28 HostConfig type marks them required even
  // though the runtime treats them as optional.
  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
};

export const HostReconciler = Reconciler(hostConfig);

export function createRoot(): {
  container: RootContainer;
  root: ReturnType<typeof HostReconciler.createContainer>;
} {
  const container: RootContainer = { children: [] };
  const root = HostReconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    '',
    (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
    null,
  );
  return { container, root };
}
