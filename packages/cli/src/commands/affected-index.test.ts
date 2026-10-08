import { describe, expect, it } from 'vitest';
import { indexOf } from './affected.js';

/**
 * The component index `variance run` and `variance collect` build from the
 * directories `source.dirs` names: the names each module's code declares, at
 * the line of the statement that declares them, so attribution can name
 * `file:line`. A declaration a comment spells is not code and is not indexed.
 */

describe('the component index', () => {
  it('indexes what the code declares and nothing a comment spells', () => {
    const source = indexOf(
      new Map([
        ['src/ds/Button.tsx', '/*\nexport function Retired() { return null }\n*/\nexport function Button() { return null }'],
      ]),
    );
    expect(source).toEqual({ Button: [{ file: 'src/ds/Button.tsx', line: 4, via: 'function' }] });
  });
});
