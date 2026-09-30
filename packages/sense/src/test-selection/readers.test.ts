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

  it('answers nothing for a text that does not parse', () => {
    expect(readersOf('src/broken.ts', 'export const = ;\n', ['LIMIT'], false)).toBeNull();
  });
});
