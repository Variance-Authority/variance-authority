import { JSX_SOURCE } from '@variance-authority/core/format';
import { describe, expect, it } from 'vitest';
import { under } from './under.js';

/**
 * A development transform running against a production React.
 *
 * This is what a project gets when it turns `jsxDev` on for a production build
 * — which is the setting to turn on, because a location is data the compiler
 * emitted rather than a name minification could rename. React ships a
 * `jsx-dev-runtime` in that build with `jsxDEV` exported as `undefined`, so the
 * runtime underneath it is called and has nothing to call. Every element on the
 * page goes through this path, and the only evidence it works is a test that
 * hands over a runtime with the hole in it.
 */

interface Call {
  readonly via: 'jsx' | 'jsxs';
  readonly type: unknown;
  readonly props: unknown;
  readonly key: unknown;
}

const productionReact = (calls: Call[]) => ({
  jsx: (type: never, props: never, key?: never) => {
    calls.push({ via: 'jsx', type, props, key });
    return null as never;
  },
  jsxs: (type: never, props: never, key?: never) => {
    calls.push({ via: 'jsxs', type, props, key });
    return null as never;
  },
});

const source = { fileName: '/repo/src/app.tsx', lineNumber: 7, columnNumber: 2 };

describe('a development runtime with no jsxDEV in it', () => {
  it('creates the element through the production runtime, with the location kept', () => {
    const calls: Call[] = [];
    const runtime = under(
      { Fragment: 'fragment', jsxDEV: undefined },
      productionReact(calls) as never,
    );

    runtime.jsxDEV('div', { id: 'card' }, undefined, false, source, undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.via).toBe('jsx');
    expect((calls[0]!.props as Record<symbol, unknown>)[JSX_SOURCE]).toEqual({
      file: '/repo/src/app.tsx',
      line: 7,
      column: 2,
    });
  });

  it('takes the static route for an element the transform marked static', () => {
    // `jsxs` rather than `jsx` is React's own distinction for children the
    // compiler knows are a fixed list, and getting it wrong costs a key warning
    // in development and nothing at all here — which is exactly why it would
    // never be noticed.
    const calls: Call[] = [];
    const runtime = under({ Fragment: 'fragment', jsxDEV: undefined }, productionReact(calls) as never);

    runtime.jsxDEV('ul', { children: [] }, 'row-1', true, source, undefined);

    expect(calls[0]?.via).toBe('jsxs');
    expect(calls[0]?.key).toBe('row-1');
  });

  it('carries React s own Fragment through untouched', () => {
    const runtime = under({ Fragment: 'fragment', jsxDEV: undefined }, productionReact([]) as never);

    expect(runtime.Fragment).toBe('fragment');
  });
});
