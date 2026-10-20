import { describe, expect, it } from 'vitest';
import { readModule } from './read.js';

/**
 * `import('./x').T` and `typeof import('./x')` are TypeScript's other spelling
 * of `import type`: the compiler resolves the specifier and erases it, so each is
 * a `type` request, and the name its qualifier starts with is the name it reads.
 */

describe('reading an `import()` type', () => {
  it('is a type-only request, after every load the module calls for', () => {
    const read = readModule(
      'a.ts',
      "const a = require('./req');\ntype T = import('./t').T.U;\nvi.mock('./m', async (original) => original<typeof import('./m')>());\n",
    );

    expect(read.requests).toEqual([
      { value: './req', kind: 'imports', bindings: [], line: 1 },
      { value: './t', kind: 'type', bindings: [], line: 2 },
      { value: './m', kind: 'type', bindings: [], line: 3 },
    ]);
    expect(read.members?.map((member) => [member.request, member.name, member.line])).toEqual([
      [1, 'T', 2],
      [2, '*', 3],
    ]);
  });
});
