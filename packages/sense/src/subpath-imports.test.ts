import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { native, nativeAvailable } from './native.js';
import { realPath, resolveTo, resolversFor } from './resolve.js';
import { scanRelations } from './scan.js';
import { packageOf, requestOf } from './specifier.js';

/**
 * A package that maps its own names in the `imports` field.
 *
 * `#polyfill` and `#internal/*` are subpath imports: the leading `#` is the
 * syntax, and the nearest `package.json` says which file each one is. The same
 * character opens a fragment in a stylesheet, where `url(#gradient)` names an
 * element of the document and no file at all. Cutting a module specifier at
 * its first `#` left nothing to resolve, and a change to the polyfill reached
 * no importer.
 */

const IMPORTER = 'src/index.ts';
const POLYFILL = 'src/polyfill.ts';
const INTERNAL = 'src/internal/clamp.ts';
const STYLE = 'src/theme.css';
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = realPath(await mkdtemp(join(tmpdir(), 'variance-subpath-')));
  roots.push(root);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'fixture',
      private: true,
      type: 'module',
      sideEffects: ['./src/polyfill.ts'],
      imports: { '#polyfill': './src/polyfill.ts', '#internal/*': './src/internal/*.ts' },
    }),
    [IMPORTER]: "import '#polyfill';\nimport { clamp } from '#internal/clamp';\nimport './theme.css';\nexport const one = clamp(1);\n",
    [POLYFILL]: 'globalThis.ready = true;\n',
    [INTERNAL]: 'export const clamp = (n: number) => n;\n',
    [STYLE]: '.mark { fill: url(#gradient); }\n',
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

function oracle(root: string, value: string): string | undefined {
  return resolveTo({
    resolvers: resolversFor({}),
    root,
    from: join(root, IMPORTER),
    request: requestOf(value)!,
    language: 'module',
  });
}

describe('a subpath import', () => {
  it('is a request, and not a package', () => {
    expect(requestOf('#polyfill')).toBe('#polyfill');
    expect(requestOf('#internal/clamp?raw#x')).toBe('#internal/clamp');
    expect(requestOf('./icons.svg#close')).toBe('./icons.svg');
    expect(packageOf('#polyfill')).toBeUndefined();
  });

  it('resolves through the imports field of the package that holds the importer', async () => {
    const root = await fixture();

    expect(oracle(root, '#polyfill')).toBe(POLYFILL);
    expect(oracle(root, '#internal/clamp')).toBe(INTERNAL);
  });

  it('is an edge in the file graph, while a stylesheet fragment stays external', async () => {
    const root = await fixture();
    const records = await scanRelations({ root, dirs: ['src'] });
    const importer = records.find((record) => record.file === IMPORTER);
    const style = records.find((record) => record.file === STYLE);

    expect(importer?.edges?.map((edge) => edge.to)).toEqual(expect.arrayContaining([POLYFILL, INTERNAL, STYLE]));
    expect(importer?.unknown).toBeUndefined();
    expect(style?.edges).toBeUndefined();
    expect(style?.unknown).toBeUndefined();
  });
});

describe('the native scanner against the oracle, on subpath imports', () => {
  it.runIf(nativeAvailable())('agrees on every request', async () => {
    const root = await fixture();
    const batch = native()!.scanBatch(root, [IMPORTER]);

    expect(batch.values).toEqual(['#polyfill', '#internal/clamp', './theme.css']);
    expect(batch.targets).toEqual(batch.values.map((value) => oracle(root, value) ?? ''));
    expect(batch.targets).toEqual([POLYFILL, INTERNAL, STYLE]);
  });

  it.runIf(nativeAvailable())('resolves an added subpath import to ask its package about sideEffects', async () => {
    const root = await fixture();
    const scanner = native()!;
    const targets = scanner.resolveSources!(root, IMPORTER, ['#polyfill', '#internal/clamp']);

    expect(targets).toEqual([POLYFILL, INTERNAL]);
    expect(scanner.declaredEffects!(root, targets)).toEqual([POLYFILL]);
  });
});
