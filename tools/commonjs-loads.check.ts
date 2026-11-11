import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs module, deliberately not part of the TS build.
import { ALLOWED, judged, loads, loadsIn } from './commonjs-loads.mjs';

/**
 * Our code reaches a module through CommonJS only where nothing else can.
 *
 * A `require`, a `createRequire(…)(…)` or an `import x = require(…)` is an edge
 * a reader following imports does not see, and `variance ask uses` does not
 * either. Our own module by a literal path and a JSON file are static imports;
 * what stays is a row in `ALLOWED` with its reason, and a row with no load left
 * under it fails too, so the list cannot outlive what it excuses.
 */

interface Load {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
}

const spelled = (found: readonly Load[]): string[] => found.map((load) => `${load.file}:${load.line} ${load.specifier}`);

describe('commonjs loads', () => {
  it('reads require, a createRequire result and import-equals as loads, and resolve as none', () => {
    const text = [
      "import { createRequire } from 'node:module';",
      "import x = require('./x.cjs');",
      "const load = createRequire(import.meta.url);",
      "load('./a.cjs');",
      "load.resolve('./b.cjs');",
      "createRequire(import.meta.url)('../package.json');",
      "require('./c.cjs');",
      "function made() { return createRequire(import.meta.url); }",
      "made()(where);",
    ].join('\n');
    expect(spelled(loadsIn('packages/p/src/a.ts', text))).toEqual([
      'packages/p/src/a.ts:2 ./x.cjs',
      'packages/p/src/a.ts:4 ./a.cjs',
      'packages/p/src/a.ts:6 ../package.json',
      'packages/p/src/a.ts:7 ./c.cjs',
      'packages/p/src/a.ts:9 where',
    ]);
  });

  it('reads a local function named require as no load', () => {
    const text = 'const require = (at: string): void => {};\nrequire("x");\n';
    expect(loadsIn('packages/p/src/a.ts', text)).toEqual([]);
  });

  it("allows a CommonJS file's literal imports by its class, and nothing computed", () => {
    const text = "import x = require('./x.cjs');\nconst y = require('./y.cjs');\nrequire(own);\n";
    const { refused } = judged(loadsIn('packages/p/src/a.cts', text), []);
    expect(spelled(refused)).toEqual(['packages/p/src/a.cts:3 own']);
  });

  it('refuses import-equals in an ECMAScript file', () => {
    const { refused } = judged(loadsIn('packages/p/src/a.ts', "import x = require('./x.cjs');\n"), []);
    expect(spelled(refused)).toEqual(['packages/p/src/a.ts:1 ./x.cjs']);
  });

  it('names a row with no load under it', () => {
    const row = { file: 'packages/p/src/a.ts', specifier: 'gone', reason: 'once' };
    expect(judged([], [row]).stale).toEqual([row]);
  });

  it('finds every load in the repository allowed, and every allowance used', () => {
    const { refused, stale } = judged(loads());
    expect(spelled(refused)).toEqual([]);
    expect(stale).toEqual([]);
    expect(ALLOWED.every((row: { reason: string }) => row.reason.length > 0)).toBe(true);
  });
});
