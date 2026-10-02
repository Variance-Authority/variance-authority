import { describe, expect, it } from 'vitest';
import { native, nativeAvailable } from '../native.js';

/**
 * Where one file observes a changed value, asked of the addon directly: in the
 * file that declares it, and in a file that imports it.
 *
 * Each field of the answer is pinned here, because selection reads every one of
 * them and no other test asks for all of them at once.
 */

const readersOf = (file: string, text: string, names: string[], imported: boolean) =>
  native()!.moduleReaders!(file, text, names, imported);

describe.runIf(nativeAvailable())('the readers of a changed value', () => {
  it('follows a value through a pure binding to the function that reads it, the load that reads it, and the name it is exported as', () => {
    const text = [
      'const LIMIT = 10;',
      'const DOUBLE = { limit: LIMIT };',
      'console.log(LIMIT);',
      'export function check(n: number) {',
      '  return n < DOUBLE.limit;',
      '}',
      'export { DOUBLE as Doubled };',
      '',
    ].join('\n');
    expect(readersOf('src/limits.ts', text, ['LIMIT'], false)).toEqual({
      reads: [{ line: 5, name: 'LIMIT' }],
      load: ['LIMIT'],
      exported: [{ name: 'Doubled', origin: 'LIMIT' }],
      untraced: false,
      imports: [],
      passed: [],
      interface: ['Doubled', 'check'],
    });
  });

  it('finds an imported value under its local name, through a namespace, and handed on by a re-export', () => {
    const text = [
      "import { LIMIT as cap, other } from './limits';",
      "import * as limits from './limits';",
      "import { load } from './loader';",
      'export const fits = (n: number) => n < cap;',
      'export function scaled(n: number) {',
      '  return n * limits.LIMIT;',
      '}',
      'register(limits);',
      "export * from './limits';",
      "export { LIMIT as Ceiling } from './limits';",
      'export { other };',
      "const later = () => import('./late');",
      '',
    ].join('\n');
    expect(readersOf('src/fits.ts', text, ['LIMIT'], true)).toEqual({
      reads: [
        { line: 4, name: 'LIMIT' },
        { line: 6, name: 'LIMIT' },
      ],
      load: ['LIMIT'],
      exported: [],
      untraced: true,
      imports: ['LIMIT', 'load', 'other'],
      passed: [
        { name: 'Ceiling', origin: 'LIMIT' },
        { name: 'LIMIT', origin: 'LIMIT' },
      ],
      interface: ['Ceiling', 'fits', 'other', 'scaled'],
    });
  });

  // A value converted as the module loads can throw or run its own code there —
  // `1n * 2` throws, a `toString` runs inside a template — so a read under the
  // conversion is a load, whichever binding it lands in.
  it.each([
    ['an arithmetic operator', 'const DOUBLED = LIMIT * 2;'],
    ['a template literal', 'const LABEL = `${LIMIT} items`;'],
    ['a unary minus', 'const NEGATIVE = -LIMIT;'],
    ['a unary plus', 'const NUMBER = +LIMIT;'],
    ['a bitwise not', 'const INVERTED = ~LIMIT;'],
    ['a loose equality', 'const TEN = LIMIT == 10;'],
    ['a relational comparison', 'const SMALL = LIMIT < 10;'],
    ['an `in` test', "const HAS = 'size' in LIMIT;"],
    ['an `instanceof` test', 'const IS = LIMIT instanceof Object;'],
    ['a computed key', 'const KEYED = { [LIMIT]: true };'],
    ['a conversion nested in a pure value', 'const NESTED = { limits: [LIMIT * 2] };'],
    ['a default export', 'export default LIMIT * 2;'],
  ])('reads a value converted by %s at top level as a load', (_, line) => {
    const text = ['const LIMIT = 10;', line, ''].join('\n');
    expect(readersOf('src/limits.ts', text, ['LIMIT'], false)?.load).toEqual(['LIMIT']);
  });

  it.each([
    ['a plain copy', 'const COPY = LIMIT;'],
    ['an object value', 'const WRAPPED = { limit: LIMIT };'],
    ['a strict equality', 'const TEN = LIMIT === 10;'],
    ['a strict inequality', 'const OTHER = LIMIT !== 10;'],
    ['a logical not', 'const NONE = !LIMIT;'],
    ['a `typeof`', 'const KIND = typeof LIMIT;'],
    ['a nullish fallback', 'const SET = LIMIT ?? 1;'],
    ['a condition', 'const PICKED = LIMIT ? 1 : 2;'],
    ['an instance field, which runs when the class is constructed', 'class Box { size = LIMIT * 2; }'],
  ])('reads a value held by %s at top level as no load', (_, line) => {
    const text = ['const LIMIT = 10;', line, ''].join('\n');
    expect(readersOf('src/limits.ts', text, ['LIMIT'], false)?.load).toEqual([]);
  });

  it('still moves a converted value to the binding that holds it', () => {
    const text = ['const LIMIT = 10;', 'const DOUBLED = LIMIT * 2;', 'export { DOUBLED };', ''].join('\n');
    expect(readersOf('src/limits.ts', text, ['LIMIT'], false)).toMatchObject({
      load: ['LIMIT'],
      exported: [{ name: 'DOUBLED', origin: 'LIMIT' }],
    });
  });

  it('answers nothing for a text that does not parse', () => {
    expect(readersOf('src/broken.ts', 'export const = ;\n', ['LIMIT'], false)).toBeNull();
  });
});
