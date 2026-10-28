import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * The files `ask-acceptance-*.test.ts` add over `ask-packages-fixture`'s
 * checkout: one shape per fact the four code questions are held to by
 * spec 0104, `docs/specs/0104-the-four-code-questions.md`. Each
 * name below is spelled for the one case it carries, so a test reads the case
 * from the name alone.
 */
const ACCEPTANCE: Readonly<Record<string, string>> = {
  'packages/core/package.json': JSON.stringify({
    name: '@acme/core',
    exports: { '.': './src/index.ts', './rules': './src/rules/index.ts' },
  }),
  'packages/core/src/index.ts':
    "export { pngSize } from './png.js';\nexport type { Tree, Coverage, CheckoutPath } from './tree.js';\nexport { Scanner } from './scanner.js';\nexport * as text from './text.js';\n",
  'packages/core/src/rules/index.ts': "export { normalize } from './normalize.js';\n",
  'packages/core/src/rules/normalize.ts': 'export function normalize(rule: string): string {\n  return rule.trim();\n}\n',
  'packages/core/src/png.ts':
    '/** The width and height a PNG header declares. */\nexport function pngSize(bytes: Uint8Array): number {\n  return bytes.length;\n}\n',
  'packages/core/src/tree.ts':
    'export interface Tree {\n  has(path: string): boolean;\n}\n\nexport interface Coverage {\n  lines: number;\n}\n\n/** A path relative to the repository root. */\nexport type CheckoutPath = string;\n',
  'packages/core/src/scanner.ts': 'export class Scanner {\n  seedFiles(): string[] {\n    return [];\n  }\n}\n',
  'packages/core/src/text.ts': 'export function shout(word: string): string {\n  return word.toUpperCase();\n}\n',
  'packages/core/src/git.ts':
    'function gitNames(): string[] {\n  return [];\n}\n\nexport const tracked = gitNames().length;\n',
  'packages/review/package.json': JSON.stringify({ name: '@acme/review', exports: { '.': './src/index.ts' } }),
  'packages/review/src/index.ts': 'export interface Coverage {\n  approved: boolean;\n}\n',
  'apps/app/src/png.ts': 'export function pngSize(path: string): number {\n  return path.length;\n}\n',
  'apps/app/src/sizes.ts':
    "import { pngSize } from '@acme/core';\nexport const sizes = [pngSize(new Uint8Array())];\n",
  'apps/app/src/local-sizes.ts': "import { pngSize as fileSize } from './png.js';\nexport const localSizes = [fileSize('a.png')];\n",
  'apps/app/src/renamed.ts': "import { greet as hi } from '@acme/lib';\nexport const renamed = hi('again');\n",
  'apps/app/src/typed.ts':
    "import type { Tree, CheckoutPath } from '@acme/core';\nexport const keep = (tree: Tree, path: CheckoutPath): boolean => tree.has(path);\n",
  'apps/app/src/written.ts':
    "import type { Tree } from '@acme/core';\nexport const stub = (tree: Tree): Tree => {\n  tree.has = () => true;\n  return tree;\n};\n",
  'apps/app/src/later.ts': "export const later = async (): Promise<string> => (await import('@acme/lib')).greet('later');\n",
  'apps/app/src/whole.ts': "import * as lib from '@acme/lib';\nimport { hold } from './hold.js';\nexport const whole = hold(lib);\n",
  'apps/app/src/limits.ts': '/** The most a size may be. */\nexport function limitOf(size: number): number {\n  return size;\n}\n',
  'apps/app/src/limited.ts': "import { limitOf } from './limits.js';\nexport const limited = limitOf(3);\n",
  'apps/app/src/hold.ts': 'export const hold = (value: unknown): unknown => value;\n',
  'apps/app/src/pair.ts': 'export const left = 1;\nexport const right = 2;\n',
  'apps/app/src/handed.ts': [
    "import * as pair from './pair.js';",
    "import { hold } from './hold.js';",
    'export async function handed(): Promise<number> {',
    "  const later = await import('./pair.js');",
    '  return first(pair) + second(later) + Number(keep(pair));',
    '}',
    'function first(from: typeof pair): number {',
    '  return from.left;',
    '}',
    "const second = (from: typeof import('./pair.js')): number => passOn(from);",
    "const passOn = (again: typeof import('./pair.js')): number => again.left;",
    'const keep = (from: typeof pair): unknown => hold(from);',
    '',
  ].join('\n'),
  'apps/app/src/loud.ts': "import { text } from '@acme/core';\nexport const loud = text.shout('hi');\n",
  'apps/app/src/hello.test.ts': "import { greet } from '@acme/lib';\nexport const greeted = greet('test');\n",
};

/** The acceptance checkout, indexed under a cache of its own before the file's tests, and left after them. */
export function indexAcceptance(label: string): void {
  const cwd = process.cwd();
  beforeAll(async () => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), `va-acceptance-${label}-`));
    checkout(ACCEPTANCE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });
  afterAll(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });
}
