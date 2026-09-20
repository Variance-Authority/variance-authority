import { JSX_SOURCE } from '@variance-authority/core/format';
import { describe, expect, it } from 'vitest';
import { record } from './record.js';

/**
 * The props object, at the moment before React receives it.
 *
 * Everything else in this package is asserted through a render, which is the
 * right height for a claim about locations reaching the DOM and the wrong one
 * for the two paths below: a config nobody can write to, and a config carrying
 * symbols that a `for…in` copy would silently drop. Both are decided here, in
 * one function, before React is involved at all — and a render cannot tell the
 * difference between "the location was never written" and "the location was
 * written to an object React then discarded".
 */

const source = { fileName: '/repo/src/app.tsx', lineNumber: 12, columnNumber: 4 };
const located = { file: '/repo/src/app.tsx', line: 12, column: 4 };

describe('a config the runtime cannot write to', () => {
  it('records the location on a copy rather than failing the element', () => {
    // A frozen object literal is not something a transform emits, but a
    // memoized props object shared between renders can arrive here sealed, and
    // an exception on the way into React takes down a page that had nothing
    // wrong with it.
    const frozen = Object.freeze({ id: 'card' });

    const recorded = record(frozen, undefined, source);

    expect(recorded.props).not.toBe(frozen);
    expect(recorded.props).toMatchObject({ id: 'card' });
    expect((recorded.props as Record<symbol, unknown>)[JSX_SOURCE]).toEqual(located);
    expect(Object.getOwnPropertySymbols(frozen)).toHaveLength(0);
  });
});

describe('a keyed config, which is the one React copies for itself', () => {
  it('carries a symbol the caller spread in', () => {
    // The key is lifted out here so React takes its no-copy path. That makes
    // this copy the only one, and `for…in` — which is what React would have
    // used — does not see symbols. A symbol dropped here is dropped for good.
    const marker = Symbol.for('variance.test.marker');
    const config = { key: 'row-1', id: 'card', [marker]: 'kept' };

    const recorded = record(config, undefined, source);
    const props = recorded.props as Record<string | symbol, unknown>;

    expect(recorded.key).toBe('row-1');
    expect(props['key']).toBeUndefined();
    expect(props[marker]).toBe('kept');
    expect(props[JSX_SOURCE]).toEqual(located);
  });

  it('prefers the key in the config to the one the transform passed', () => {
    const recorded = record({ key: 'from-config' }, 'from-transform', source);

    expect(recorded.key).toBe('from-config');
  });

  it('falls back to the transform key when the config declares one and leaves it undefined', () => {
    const recorded = record({ key: undefined }, 'from-transform', source);

    expect(recorded.key).toBe('from-transform');
  });
});

describe('a call the location cannot be read from', () => {
  it.each([
    ['no source at all', undefined],
    ['a source that is not an object', 'src/app.tsx' as unknown],
    ['a source with no file name', { lineNumber: 1 }],
    ['a source with an empty file name', { fileName: '', lineNumber: 1 }],
    ['a source with no line number', { fileName: 'src/app.tsx' }],
  ])('hands back what React would have received: %s', (_case, given) => {
    const config = { id: 'card' };

    const recorded = record(config, 'k', given as never);

    expect(recorded.props).toBe(config);
    expect(recorded.key).toBe('k');
    expect(Object.getOwnPropertySymbols(config)).toHaveLength(0);
  });

  it('reads a location whose column the transform left out, at column zero', () => {
    // Not every transform fills the column in, and a location without one is
    // still a location: the file and the line are what a diff speaks in.
    const recorded = record({}, undefined, { fileName: '/repo/src/app.tsx', lineNumber: 12 });

    expect((recorded.props as Record<symbol, unknown>)[JSX_SOURCE]).toEqual({
      file: '/repo/src/app.tsx',
      line: 12,
      column: 0,
    });
  });

  it('leaves a config that is not an object alone', () => {
    expect(record(null, 'k', source)).toEqual({ props: null, key: 'k' });
  });
});
