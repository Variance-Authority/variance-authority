// @vitest-environment jsdom
//
// Every assertion in this file is a measurement of a React internal, and each one
// is written so that a React release which moves the internal fails *here* rather
// than silently emptying a band. The dangerous failure for wiring is not an
// exception: it is a `hooks` that becomes `undefined`, at which point two
// components with different hook shapes hash identically and the band reports
// that nothing changed. So the cases below assert content, never mere presence.

import { createElement as h, act, createContext, forwardRef, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keyedByPosition } from '@variance-authority/core/format';
import { wiringOf } from './wiring.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

function at(marker: string): Element {
  const found = container.querySelector(`[data-t="${marker}"]`);
  if (!found) throw new Error(`no node marked ${marker}`);
  return found;
}

describe('hook shape', () => {
  it('is React’s own record, in call order, with the pairs no heuristic can split', async () => {
    function Hooked() {
      useState(1);
      useRef(2);
      // `useMemo` and `useCallback` build identical `[value, deps]` cells, and
      // `useEffect` and `useLayoutEffect` build identical effect objects. A
      // reader that inferred names from the hook chain would collapse each pair.
      // React recorded the call, so this does not have to guess.
      useMemo(() => 3, []);
      useEffect(() => undefined, []);
      return h('span', { 'data-t': 'hooked' });
    }

    await render(h(Hooked, null));

    expect(wiringOf(at('hooked'))?.hooks).toEqual(['useState', 'useRef', 'useMemo', 'useEffect']);
  });

  it('says nothing about a component that declares no hooks', async () => {
    function Bare() {
      return h('span', { 'data-t': 'bare' });
    }

    await render(h(Bare, null));

    // Measured, and the reason `hookNames` is conservative: React initialises
    // `_debugHookTypes` to `null` and assigns an array only once a hook runs, so
    // a hookless component in a *development* build is indistinguishable from
    // any component in a production one. `[]` here would be a positive claim
    // this observation cannot support, and the band would then report a
    // component gaining its first `useState` as if it had merely become
    // readable.
    expect(wiringOf(at('bare'))?.hooks).toBeUndefined();
  });

  it('separates two components that render the same document', async () => {
    // The case the band exists for. Identical output, different components.
    function Controlled() {
      const [value] = useState('a');
      return h('span', { 'data-t': 'controlled' }, value);
    }
    function Static() {
      return h('span', { 'data-t': 'static' }, 'a');
    }

    await render(h('div', null, h(Controlled, null), h(Static, null)));

    expect(at('controlled').outerHTML.replace('controlled', 'x')).toBe(
      at('static').outerHTML.replace('static', 'x'),
    );
    expect(wiringOf(at('controlled'))?.hooks).not.toEqual(wiringOf(at('static'))?.hooks);
  });
});

describe('wrappers', () => {
  it('names memo on the collapsed form React uses for a plain function', async () => {
    const Card = memo(function Card() {
      return h('span', { 'data-t': 'card' });
    });

    await render(h(Card, null));

    // `memo(fn)` collapses to a single SimpleMemoComponent fiber (tag 15), so
    // there is no wrapper fiber to walk up to and the tag alone carries it.
    expect(wiringOf(at('card'))?.wrappers).toEqual(['memo']);
  });

  it('names both wrappers on the form that cannot collapse', async () => {
    const Field = memo(
      forwardRef<HTMLSpanElement>(function Field(_props, ref) {
        return h('span', { 'data-t': 'field', ref });
      }),
    );

    await render(h(Field, null));

    // `memo(forwardRef(f))` is a MemoComponent (14) above a ForwardRef (11).
    // Reading `fiber.tag` alone would report a bare `forwardRef` and say the
    // component lost a `memo` it still has.
    expect(wiringOf(at('field'))?.wrappers).toEqual(['memo', 'forwardRef']);
  });

  it('says nothing about a plain component', async () => {
    function Plain() {
      return h('span', { 'data-t': 'plain' });
    }

    await render(h(Plain, null));

    expect(wiringOf(at('plain'))?.wrappers).toBeUndefined();
  });
});

describe('context subscriptions', () => {
  it('names the contexts a component reads, which the hook chain does not record', async () => {
    const Theme = createContext('light');
    Theme.displayName = 'ThemeContext';
    const Locale = createContext('en');
    Locale.displayName = 'LocaleContext';

    function Label() {
      // Measured on 19.2.8: `useContext` leaves **no entry** in the hook chain.
      // `fiber.dependencies` is the only record that this edge exists.
      useContext(Theme);
      useContext(Locale);
      return h('span', { 'data-t': 'label' });
    }

    await render(
      h(Theme.Provider, { value: 'dark' }, h(Locale.Provider, { value: 'fr' }, h(Label, null))),
    );

    expect(wiringOf(at('label'))?.contexts).toEqual(['LocaleContext', 'ThemeContext']);
  });

  it('separates a component that reads a theme from one that only looks themed', async () => {
    const Theme = createContext('light');
    Theme.displayName = 'ThemeContext';

    function Subscribed() {
      const tone = useContext(Theme);
      return h('span', { 'data-t': 'subscribed', 'data-tone': tone });
    }
    function Cascaded() {
      // Same markup, same rendered attribute, no subscription. Under a theme
      // switch this one changes through CSS and that one changes through React,
      // and those are different explanations for the same visual difference.
      return h('span', { 'data-t': 'cascaded', 'data-tone': 'dark' });
    }

    await render(h(Theme.Provider, { value: 'dark' }, h('div', null, h(Subscribed, null), h(Cascaded, null))));

    expect(at('subscribed').getAttribute('data-tone')).toBe(
      at('cascaded').getAttribute('data-tone'),
    );
    expect(wiringOf(at('subscribed'))?.contexts).toEqual(['ThemeContext']);
    expect(wiringOf(at('cascaded'))?.contexts).toBeUndefined();
  });
});

describe('reconciliation keys', () => {
  it('separates two lists that serialize identically', async () => {
    const items = ['a', 'b', 'c'];
    function ByIndex() {
      return h(
        'ul',
        { 'data-t': 'byIndex' },
        items.map((item, index) => h('li', { key: index }, item)),
      );
    }
    function ById() {
      return h(
        'ul',
        { 'data-t': 'byId' },
        items.map((item) => h('li', { key: item }, item)),
      );
    }

    await render(h('div', null, h(ByIndex, null), h(ById, null)));

    // Byte-identical documents. Everything a serializer of HTML and CSS can see
    // agrees, and the two lists behave differently the moment anything reorders.
    expect(at('byIndex').innerHTML).toBe(at('byId').innerHTML);

    const keysOf = (marker: string): (string | undefined)[] =>
      [...at(marker).children].map((child) => wiringOf(child)?.key);

    expect(keysOf('byIndex')).toEqual(['0', '1', '2']);
    expect(keysOf('byId')).toEqual(['a', 'b', 'c']);

    // And the derived reading, which is the sentence a report would carry.
    expect(keyedByPosition(keysOf('byIndex'))).toBe(true);
    expect(keyedByPosition(keysOf('byId'))).toBe(false);
  });
});

describe('where wiring attaches', () => {
  it('lands on a component’s root node and not on the elements beneath it', async () => {
    function Panel() {
      useState(0);
      return h('div', { 'data-t': 'panel' }, h('span', { 'data-t': 'inner' }, 'x'));
    }

    await render(h(Panel, null));

    expect(wiringOf(at('panel'))?.hooks).toEqual(['useState']);
    // Not `Panel`'s hooks repeated. `shapeOf` folds every node a boundary owns,
    // so repeating them here would make the band's value depend on how many
    // wrapper elements the component happens to render — a `<div>` added for
    // layout would move the "wiring" digest, which is a lie about what wiring is.
    expect(wiringOf(at('inner'))).toBeUndefined();
  });

  it('reaches through the wrappers that are not components', async () => {
    function Wrapped() {
      useState(0);
      // A Fragment sits between the component and its output. It is not a
      // component and must not sever one from its own root node.
      return h('span', { 'data-t': 'wrapped' });
    }

    await render(h('div', null, h(Wrapped, null)));

    expect(wiringOf(at('wrapped'))?.hooks).toEqual(['useState']);
  });

  it('says nothing at all about a node React never rendered', async () => {
    await render(h('div', null));
    const foreign = document.createElement('span');
    container.appendChild(foreign);

    // Absent, not empty. A page this package cannot read must not compare equal
    // to a page it read and found nothing in.
    expect(wiringOf(foreign)).toBeUndefined();
  });
});

describe('the rule that decides what is a band', () => {
  it('does not move when the same page is read twice without changing it', async () => {
    const Theme = createContext('light');
    Theme.displayName = 'ThemeContext';

    const Row = memo(function Row() {
      useState(0);
      useContext(Theme);
      useEffect(() => undefined, []);
      return h('li', { 'data-t': 'row' });
    });

    await render(h(Theme.Provider, { value: 'dark' }, h('ul', null, h(Row, { key: 'r' }))));

    // The band contract, stated as an assertion rather than left as a
    // convention. Everything in `Wiring` survives this; the fiber's most useful
    // single fact — whether an instance remounted — does not, by construction,
    // which is why it lives in `identity.ts` as a finding instead.
    const first = wiringOf(at('row'));
    const second = wiringOf(at('row'));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first).toEqual({
      hooks: ['useState', 'useContext', 'useEffect'],
      wrappers: ['memo'],
      contexts: ['ThemeContext'],
      key: 'r',
    });
  });

  it('does not move across an unrelated re-render of the same component', async () => {
    function Counter({ tick }: { tick: number }) {
      const [n] = useState(0);
      return h('span', { 'data-t': 'counter' }, `${String(n)}/${String(tick)}`);
    }

    await render(h(Counter, { tick: 0 }));
    const before = wiringOf(at('counter'));

    await render(h(Counter, { tick: 1 }));
    const after = wiringOf(at('counter'));

    // The document moved and the wiring did not, which is the whole point of a
    // band that is not `text`.
    expect(at('counter').textContent).toBe('0/1');
    expect(after).toEqual(before);
  });
});
