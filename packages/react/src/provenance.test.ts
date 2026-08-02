// @vitest-environment jsdom
//
// The root `vitest.config.ts` runs the suite under `node`. This docblock is the
// per-file override, chosen over a project config so that adding a DOM-needing
// package does not change how every other package's tests are executed.
//
// These tests render real React trees and read real fibers. Nothing is mocked:
// the entire value of this package is that it survives contact with React's
// actual internals, and a test double of a fiber would assert only that we
// agree with ourselves.

import { Component, act, createElement as h, forwardRef, memo, version } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ANONYMOUS,
  NO_FIBER,
  componentName,
  debugOwnerName,
  detectReactRuntime,
  findReactContainers,
  provenanceOf,
  resolveProvenance,
} from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(element: unknown): Promise<void> {
  await act(async () => {
    root.render(element as never);
  });
}

function find(marker: string): Element {
  const element = document.querySelector(`[data-t="${marker}"]`);
  if (!element) throw new Error(`no element marked ${marker}`);
  return element;
}

function ownersOf(marker: string): { name: string; propsDigest: string }[] {
  const result = resolveProvenance(find(marker));
  if (result.status !== 'resolved') throw new Error(`expected a fiber for ${marker}`);
  return result.provenance.owners.map((frame) => ({ ...frame }));
}

function names(marker: string): string[] {
  return ownersOf(marker).map((frame) => frame.name);
}

describe('owner chains', () => {
  function Leaf({ label }: { label: string }) {
    return h('span', { 'data-t': 'leaf' }, label);
  }

  class Panel extends Component<{ children?: unknown }> {
    override render() {
      return h('section', { 'data-t': 'panel' }, this.props.children as never);
    }
  }

  function Middle({ label }: { label: string }) {
    return h('div', null, h(Leaf, { label }));
  }

  function App({ label }: { label: string }) {
    return h('main', null, h(Middle, { label }), h(Panel, null, h(Leaf, { label })));
  }

  it('lists composite components innermost-first and omits host elements', async () => {
    await render(h(App, { label: 'x' }));
    expect(names('leaf')).toEqual(['Leaf', 'Middle', 'App']);
  });

  it('places a component passed as children under the component that renders it', async () => {
    await render(h(App, { label: 'x' }));
    // App authored both `<Leaf>`s. The second was handed to Panel as children,
    // so Panel encloses it even though Panel's own JSX never mentions Leaf.
    const both = document.querySelectorAll('[data-t="leaf"]');
    const second = both[1];
    if (!second) throw new Error('expected two leaves');
    const result = resolveProvenance(second);
    if (result.status !== 'resolved') throw new Error('expected a fiber');
    expect(result.provenance.owners.map((frame) => frame.name)).toEqual(['Leaf', 'Panel', 'App']);
  });

  it('resolves the full chain from a host element buried under host elements', async () => {
    function Deep() {
      return h(
        'div',
        null,
        h('div', null, h('div', null, h('ul', null, h('li', { 'data-t': 'deep' }, 'x')))),
      );
    }
    function Outer() {
      return h('div', null, h(Deep, null));
    }

    await render(h(Outer, null));
    // Four host levels between the marked node and the nearest component: the
    // walk must not stop at the first non-composite fiber it meets.
    expect(names('deep')).toEqual(['Deep', 'Outer']);
  });

  it('reports the class component by name, not by its host output', async () => {
    await render(h(App, { label: 'x' }));
    expect(names('panel')).toEqual(['Panel', 'App']);
  });
});

describe('wrapper unwrapping', () => {
  const Fancy = forwardRef<HTMLElement, { tone: string }>(function FancyInner(props, ref) {
    return h('i', { ref, 'data-t': 'fancy', className: props.tone });
  });
  const MemoFancy = memo(Fancy);

  // A plain function with no comparator: React collapses this to a single
  // SimpleMemoComponent fiber.
  const SimpleMemo = memo(function Simple() {
    return h('u', { 'data-t': 'simple' });
  });

  // A comparator forces the two-fiber MemoComponent representation.
  const ComparedMemo = memo(
    function Compared() {
      return h('s', { 'data-t': 'compared' });
    },
    () => false,
  );

  const Renamed = memo(function Original() {
    return h('b', { 'data-t': 'renamed' });
  });
  Renamed.displayName = 'ExplicitName';

  function Host() {
    return h(
      'div',
      null,
      h(MemoFancy, { tone: 'warm' }),
      h(SimpleMemo, null),
      h(ComparedMemo, null),
      h(Renamed, null),
    );
  }

  it('names memo(forwardRef(fn)) once, using the inner function name', async () => {
    await render(h(Host, null));
    // `memo(forwardRef(f))` renders as a MemoComponent fiber *plus* a ForwardRef
    // fiber. Both would resolve to `FancyInner`; the chain must contain one.
    expect(names('fancy')).toEqual(['FancyInner', 'Host']);
  });

  it('names memo(fn) with the inner function name', async () => {
    await render(h(Host, null));
    expect(names('simple')).toEqual(['Simple', 'Host']);
  });

  it('does not duplicate a frame for memo with a custom comparator', async () => {
    await render(h(Host, null));
    expect(names('compared')).toEqual(['Compared', 'Host']);
  });

  it('prefers an explicit displayName on the wrapper over the inner name', async () => {
    await render(h(Host, null));
    expect(names('renamed')).toEqual(['ExplicitName', 'Host']);
  });

  it('resolves wrapper names without a fiber', () => {
    expect(componentName(memo(forwardRef(function Deepest() {
      return null;
    })))).toBe('Deepest');
    expect(componentName(() => null)).toBe(ANONYMOUS);
    expect(componentName(null)).toBe(ANONYMOUS);
    expect(componentName({ $$typeof: Symbol.for('react.memo') })).toBe(ANONYMOUS);
  });
});

describe('createdBy versus owners', () => {
  function Slot({ node }: { node: unknown }) {
    return h('div', { 'data-t': 'slot' }, node as never);
  }

  function Badge() {
    return h('em', { 'data-t': 'badge' });
  }

  function Author() {
    return h(Slot, { node: h('b', { 'data-t': 'passed' }, 'hi') });
  }

  function Composer() {
    return h(Slot, { node: h(Badge, null) });
  }

  it('separates the author of the JSX from the component that encloses it', async () => {
    await render(h(Author, null));
    const result = resolveProvenance(find('passed'));
    if (result.status !== 'resolved') throw new Error('expected a fiber');

    // `<b>` was written inside Author, but Slot is what rendered it into the
    // tree. Both facts are true and they answer different questions.
    expect(result.provenance.createdBy).toBe('Author');
    expect(result.provenance.owners[0]?.name).toBe('Slot');
    expect(result.provenance.createdBy).not.toBe(result.provenance.owners[0]?.name);
  });

  it('encloses a component passed as a prop under its renderer', async () => {
    await render(h(Composer, null));
    expect(names('badge')).toEqual(['Badge', 'Slot', 'Composer']);
  });

  it('omits createdBy rather than inventing one at the root', async () => {
    function Solo() {
      return h('p', { 'data-t': 'solo' });
    }
    await render(h(Solo, null));
    const result = resolveProvenance(find('solo'));
    if (result.status !== 'resolved') throw new Error('expected a fiber');
    expect(result.provenance.createdBy).toBe('Solo');
    expect('source' in result.provenance).toBe(false);
  });
});

describe('props digest', () => {
  function Leaf({ label }: { label: string; onPick?: () => void }) {
    return h('span', { 'data-t': 'leaf' }, label);
  }

  function Wrapper({ label }: { label: string }) {
    // A fresh arrow every render: identity-based digesting would report this as
    // changed on every commit (spec §11.2). `core`'s shape-based digest must not.
    return h(Leaf, { label, onPick: () => undefined });
  }

  function digest(): string {
    const frame = ownersOf('leaf')[0];
    if (!frame) throw new Error('no owner frame');
    return frame.propsDigest;
  }

  it('holds across a re-render that changes nothing', async () => {
    await render(h(Wrapper, { label: 'a' }));
    const first = digest();
    await render(h(Wrapper, { label: 'a' }));
    expect(digest()).toBe(first);
  });

  it('moves when a meaningful prop changes, and returns when it reverts', async () => {
    await render(h(Wrapper, { label: 'a' }));
    const forA = digest();

    await render(h(Wrapper, { label: 'b' }));
    const forB = digest();
    expect(forB).not.toBe(forA);

    // Third commit. The DOM node's cached fiber pointer is written once at mount
    // and never re-pointed, so on alternating commits it addresses the *stale*
    // half of React's double buffer. Without resolving to the current fiber this
    // assertion fails: the digest would lag one render behind.
    await render(h(Wrapper, { label: 'a' }));
    expect(digest()).toBe(forA);
  });

  it('reads the props actually in force, not the previous render’s', async () => {
    await render(h(Wrapper, { label: 'a' }));
    await render(h(Wrapper, { label: 'b' }));
    const afterTwoCommits = digest();

    // A tree freshly mounted with `b` has no stale alternate at all, so its
    // digest is the ground truth for "props are b".
    const fresh = document.createElement('div');
    document.body.appendChild(fresh);
    const freshRoot = createRoot(fresh);
    await act(async () => {
      freshRoot.render(h(Wrapper, { label: 'b' }));
    });
    const groundTruth = ownersOf('leaf')[0]?.propsDigest;

    expect(afterTwoCommits).toBe(groundTruth);

    await act(async () => {
      freshRoot.unmount();
    });
    fresh.remove();
  });

  it('excludes children so a descendant change does not move an ancestor digest', async () => {
    function Shell({ children }: { children?: unknown }) {
      return h('div', { 'data-t': 'shell' }, children as never);
    }
    function Tree({ text }: { text: string }) {
      return h(Shell, null, h('span', null, text));
    }

    await render(h(Tree, { text: 'one' }));
    const before = ownersOf('shell')[0]?.propsDigest;

    await render(h(Tree, { text: 'two' }));
    const after = ownersOf('shell')[0]?.propsDigest;

    // Shell's own props did not change; only its subtree did. §6.2 needs this to
    // hold or Shell could never be identified as the root of an internal change.
    expect(after).toBe(before);
  });
});

describe('nodes React never rendered', () => {
  it('returns the documented sentinel for a plain DOM element', () => {
    const orphan = document.createElement('div');
    document.body.appendChild(orphan);

    const result = resolveProvenance(orphan);
    expect(result).toBe(NO_FIBER);
    expect(result.status).toBe('no-fiber');
    expect(result).toMatchObject({ reason: 'no-client-fiber' });
    expect(provenanceOf(orphan)).toBeUndefined();

    orphan.remove();
  });

  it('reports no fiber for a node whose root was unmounted', async () => {
    function Solo() {
      return h('p', { 'data-t': 'solo' });
    }
    await render(h(Solo, null));
    const node = find('solo');
    expect(resolveProvenance(node).status).toBe('resolved');

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);

    // React deletes the expando keys on unmount, so a torn-down subtree is
    // indistinguishable from non-React DOM. Documented, not worked around.
    expect(resolveProvenance(node).status).toBe('no-fiber');
  });

  it('reports no fiber for a detached document fragment host', () => {
    const detached = document.createElement('section');
    expect(provenanceOf(detached)).toBeUndefined();
  });

  it('reports no fiber for server-rendered markup that was never hydrated', () => {
    // The closest reproducible stand-in for spec §11.6. Markup that arrived as a
    // string carries no expando, so from the client it is indistinguishable from
    // third-party DOM — which is exactly the point of the sentinel: the
    // collector records "not attributable" instead of inventing an empty chain.
    function Server() {
      return h('article', { 'data-t': 'server' }, 'rendered on the server');
    }
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(h(Server, null));
    document.body.appendChild(host);

    const node = host.querySelector('[data-t="server"]');
    if (!node) throw new Error('expected server markup');
    expect(resolveProvenance(node)).toBe(NO_FIBER);

    host.remove();
  });

  it('names a server-component owner record, which carries no fiber', () => {
    // React 19 made `_debugOwner` polymorphic: a client owner is a Fiber, a
    // server one is a `ReactComponentInfo` — a name and an env, with no `tag`,
    // no `type`, and no props. Constructed here rather than rendered because a
    // real RSC payload needs a flight runtime; the shape is what we handle.
    expect(debugOwnerName({ name: 'ServerList', env: 'Server' })).toBe('ServerList');
    expect(debugOwnerName({ env: 'Server' })).toBeNull();
    expect(debugOwnerName(null)).toBeNull();
  });
});

describe('runtime discovery', () => {
  it('finds React containers structurally, with no DevTools hook installed', async () => {
    expect(
      (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'],
    ).toBeUndefined();

    function Solo() {
      return h('p', { 'data-t': 'solo' });
    }
    await render(h(Solo, null));

    expect(findReactContainers(document.body)).toContain(container);
  });

  it('reports the expando convention, and no exact version without a hook', async () => {
    function Solo() {
      return h('p', { 'data-t': 'solo' });
    }
    await render(h(Solo, null));

    const info = detectReactRuntime(find('solo'));
    expect(info.keyFormat).toBe('reactFiber');
    expect(info.majorHint).toBe('>=17');
    // Recorded so the journal's "tested against" claim is checkable, and so a
    // future React that changes the expando format fails here loudly.
    expect(version.startsWith('19.')).toBe(true);
    expect(info.version).toBeUndefined();
  });
});
