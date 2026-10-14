// Source chains: a host node's fiber, walked up to the elements that produced
// it. Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { forwardRef, memo } from 'react';
import { jsx } from 'react/jsx-runtime';
import { test } from 'vitest';

import { sourceChain } from '../dist/internal.js';
import { jsxDEV } from '../dist/jsx-dev-runtime.js';
import { HostReconciler, createRoot } from '../dist/reconciler.js';

const at = (fileName, lineNumber, columnNumber) => ({ fileName, lineNumber, columnNumber });
const resolve = (file) => `/abs/${file}`;

function mount(element) {
  const { container, root } = createRoot();
  const render = (next) => HostReconciler.flushSync(() => HostReconciler.updateContainer(next, root, null, null));
  render(element);
  return { container, render };
}

function Title() {
  return jsxDEV('rect', { width: 1 }, undefined, false, at('title.tsx', 5, 3));
}

test('lists the nearest element first, then its ancestors', () => {
  const { container } = mount(jsxDEV(Title, {}, undefined, false, at('entry.tsx', 9, 5)));
  assert.deepEqual(sourceChain(container.children[0], resolve), [
    { name: 'rect', file: '/abs/title.tsx', line: 5, column: 3 },
    { name: 'Title', file: '/abs/entry.tsx', line: 9, column: 5 },
  ]);
});

test('skips elements without a source', () => {
  function Middle() {
    return jsx(Title, {});
  }
  const { container } = mount(jsxDEV(Middle, {}, undefined, false, at('entry.tsx', 9, 5)));
  assert.deepEqual(sourceChain(container.children[0], resolve), [
    { name: 'rect', file: '/abs/title.tsx', line: 5, column: 3 },
    { name: 'Middle', file: '/abs/entry.tsx', line: 9, column: 5 },
  ]);
});

test('merges adjacent duplicates', () => {
  // Both fibers were written at the same place, as a component returning
  // the element it was given does.
  const same = at('wrap.tsx', 2, 2);
  function Wrap({ children }) {
    return children;
  }
  const { container } = mount(
    jsxDEV(Wrap, { children: jsxDEV('rect', {}, undefined, false, same) }, undefined, false, same),
  );
  const chain = sourceChain(container.children[0], resolve);
  assert.deepEqual(chain, [{ name: 'rect', file: '/abs/wrap.tsx', line: 2, column: 2 }]);
});

test('is empty without positions', () => {
  function Plain() {
    return jsx('rect', {});
  }
  const { container } = mount(jsx(Plain, {}));
  assert.deepEqual(sourceChain(container.children[0], resolve), []);
});

test('survives updates that skip commitUpdate', () => {
  const entry = () => jsxDEV(Title, {}, undefined, false, at('entry.tsx', 9, 5));
  const { container, render } = mount(entry());
  const node = container.children[0];
  const before = sourceChain(node, resolve);
  render(entry());
  render(entry());
  assert.equal(container.children[0], node);
  assert.deepEqual(sourceChain(node, resolve), before);
  assert.equal(before.length, 2);
});

test('names memo and forwardRef components', () => {
  const Memo = memo(Title);
  const Forwarded = forwardRef(function Inner(_props, _ref) {
    return jsxDEV('rect', {}, undefined, false, at('inner.tsx', 1, 1));
  });
  Forwarded.displayName = 'Shown';
  const { container } = mount(
    jsxDEV('group', {
      children: [
        jsxDEV(Memo, {}, 'a', false, at('entry.tsx', 1, 1)),
        jsxDEV(Forwarded, {}, 'b', false, at('entry.tsx', 2, 1)),
      ],
    }, undefined, true, at('entry.tsx', 0, 0)),
  );
  const [memoRect, forwardedRect] = container.children[0].children;
  assert.equal(sourceChain(memoRect, resolve)[1].name, 'Title');
  assert.equal(sourceChain(forwardedRect, resolve)[1].name, 'Shown');
});
