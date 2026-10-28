import { describe, expect, it } from 'vitest';
import { readModule } from './read.js';

/**
 * `import('./x').T` and `typeof import('./x')` are TypeScript's other spelling
 * of `import type`: the compiler resolves the specifier and erases it, so each is
 * a `type` request, and the name its qualifier starts with is the name it reads.
 * A bare `typeof import('./x')` reads no name: it only types a value.
 */

describe('reading an `import()` type', () => {
  it('is a type-only request, after every load the module calls for', () => {
    const read = readModule(
      'a.ts',
      "const d = await import('./d');\nconst a = require('./req');\ntype T = import('./t').T.U;\nvi.mock('./m', async (original) => original<typeof import('./m')>());\nd.run();\n",
    );

    expect(read.requests).toEqual([
      { value: './d', kind: 'dynamic', bindings: [], line: 1 },
      { value: './req', kind: 'imports', bindings: [], line: 2 },
      { value: './t', kind: 'type', bindings: [], line: 3 },
      { value: './m', kind: 'type', bindings: [], line: 4 },
    ]);
    expect(read.members?.map((member) => [member.request, member.name, member.line])).toEqual([
      [0, 'run', 5],
      [2, 'T', 3],
    ]);
  });
});
