// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';
import probeLog from './probe-log.cjs';

/** The tap as a seam loads it: built, because it `require`s the engine by the name the build gives it. */
const storyTap = createRequire(import.meta.url)('../../dist/instrument/story-tap.cjs') as typeof import('./story-tap.cjs');

/** A theme provided at the top and read twice below, once through a memoised component. */
const THEMED = `
const Theme = React.createContext(null);
function Panel(props) { return React.createElement(Theme.Consumer, null, (theme) => React.createElement('p', { id: 'panel' }, theme.name)) }
const Shown = React.memo(Panel);
function App({ theme }) { return React.createElement(Theme.Provider, { value: theme }, React.createElement(Shown)) }
`;

/** {@link THEMED} evaluated behind a tap, and rendered once into the document with `theme`. */
function rendered(theme: object) {
  const engine = probeLog.createEngine(false);
  engine.use(engine.open('case'));
  const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
  const context = createContext({ React, __VA__: tap.root });
  runInContext(instrument(THEMED, 'themed.js')!.code, context, { filename: 'themed.js' });
  const host = document.createElement('div');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  React.act(() => createRoot(host).render(React.createElement(runInContext('App', context), { theme })));
  return { tap, host, binding: (name: string) => runInContext(name, context) as object };
}

describe('what a React tree was handed', () => {
  it('names the value a provider was given and the one its consumer read by the same ref', () => {
    const { tap } = rendered({ name: 'dark' });

    const said = tap.read().notes.map(([, , text]) => text);
    expect(said[0]).toBe(
      'holds Theme=ref1 react.context, Panel=ref2 function Panel, Shown=ref3 react.memo, App=ref4 function App',
    );
    expect(said.slice(1)).toEqual(['handed theme=ref5 Object', expect.stringMatching(/^handed props=ref\d+ Object$/), 'handed theme=ref5 Object']);
  });

  it('leads from a rendered node to the binding that declared its component, however it was wrapped', () => {
    const { tap, host, binding } = rendered({ name: 'dark' });
    const node = host.querySelector('#panel')!;
    type Fiber = { _debugOwner: Fiber | null; type: object; elementType: object };
    let owner = (node[Object.keys(node).find((key) => key.startsWith('__reactFiber$')) as keyof Element] as unknown as Fiber)
      ._debugOwner;
    // The nearest owner is the context consumer, which no binding held: go up
    // until an owner is a value some region was handed.
    while (owner !== null && tap.identify(owner.elementType) === undefined) owner = owner._debugOwner;

    expect(tap.identify(owner!.elementType)).toEqual({
      ref: 'ref3',
      kind: 'react.memo',
      module: 'themed.js',
      region: 0,
      name: 'Shown',
    });
    expect(tap.identify(owner!.type)).toMatchObject({ name: 'Panel', module: 'themed.js' });
    expect(owner!.type).toBe(binding('Panel'));
  });
});
