// @vitest-environment jsdom
//
// Real React, real fibers. What is asserted is identity: the function the
// registry hands over must be the one React called, because the whole point is
// to give the engine a value it already knows the location of.

import { Component, act, createElement as h, forwardRef, memo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeclarationRegistry, componentFunction, provenanceOf } from './index.js';

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

function Leaf({ label }: { label: string }) {
  return h('span', { 'data-t': 'leaf' }, label);
}

const Fancy = forwardRef<HTMLElement, { tone: string }>(function FancyInner(props, ref) {
  return h('i', { ref, 'data-t': 'fancy', className: props.tone });
});

const Simple = memo(function SimpleInner() {
  return h('u', { 'data-t': 'simple' });
});

const Compared = memo(
  function ComparedInner() {
    return h('s', { 'data-t': 'compared' });
  },
  () => false,
);

class Panel extends Component<{ children?: unknown }> {
  override render() {
    return h('section', { 'data-t': 'panel' }, this.props.children as never);
  }
}

function App() {
  return h(
    Panel,
    null,
    h(Leaf, { label: 'a' }),
    h(Leaf, { label: 'b' }),
    h(Fancy, { tone: 'warm' }),
    h(Simple, null),
    h(Compared, null),
  );
}

describe('the declaration registry', () => {
  it('holds the function React called, once, under the name provenance reports', async () => {
    await render(h(App));
    const declared = createDeclarationRegistry();

    const provenance = provenanceOf(find('leaf'), declared);
    expect(provenance?.owners.map((frame) => frame.name)).toEqual(['Leaf', 'Panel', 'App']);
    // Met in walk order: the leaf, then the owner that authored it, then the
    // frame above. Which order is not the claim; the pairing is.
    const held = new Map(declared.names.map((name, index) => [name, declared.functions[index]]));
    expect([...held.keys()].sort()).toEqual(['App', 'Leaf', 'Panel']);
    expect(held.get('Leaf')).toBe(Leaf);
    expect(held.get('Panel')).toBe(Panel);
    expect(held.get('App')).toBe(App);

    // The second Leaf is the same function; the registry does not grow.
    for (const element of document.querySelectorAll('[data-t="leaf"]')) provenanceOf(element, declared);
    expect(declared.names).toHaveLength(3);
  });

  it('unwraps memo and forwardRef to the function inside', async () => {
    await render(h(App));
    const declared = createDeclarationRegistry();
    provenanceOf(find('fancy'), declared);
    provenanceOf(find('simple'), declared);
    provenanceOf(find('compared'), declared);

    const byName = new Map(declared.names.map((name, index) => [name, declared.functions[index]]));
    expect(byName.get('FancyInner')).toBe((Fancy as unknown as { render: Function }).render);
    expect(byName.get('SimpleInner')).toBe((Simple as unknown as { type: Function }).type);
    expect(byName.get('ComparedInner')).toBe((Compared as unknown as { type: Function }).type);
    // Owner frames that are pure wrappers add no second entry for the same function.
    expect(declared.functions.filter((fn) => fn === byName.get('SimpleInner'))).toHaveLength(1);
  });

  it('is silent for a node React does not own', () => {
    const declared = createDeclarationRegistry();
    expect(provenanceOf(document.body, declared)).toBeUndefined();
    expect(declared.names).toEqual([]);
  });

  it('answers nothing for a value that is not a component', () => {
    expect(componentFunction('div')).toBeNull();
    expect(componentFunction(null)).toBeNull();
    expect(componentFunction({ $$typeof: Symbol.for('react.memo'), type: 'div' })).toBeNull();
  });
});
