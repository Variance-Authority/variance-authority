import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { native, nativeAvailable } from './native.js';
import { realPath, resolveTo, resolversFor } from './resolve.js';
import { scanRelations } from './scan.js';

/**
 * A relative import whose only answer is a declaration file.
 *
 * TypeScript finds `./context` in `context.d.ts` when no `context.ts` or
 * `context.tsx` sits beside it, and a package of shared types is often nothing
 * but such files importing each other. A resolver that never tries `.d.ts`
 * leaves every one of those imports unresolved, so a change to a declaration
 * reaches none of the files that import it.
 *
 * The other half is what the declaration must not take. Beside `.ts` or `.tsx`
 * of the same name it is that file's output or its stand-in, and beside a
 * `.js` in a package written in JavaScript it describes the file a runtime
 * import loads. TypeScript's type lookup would still pick the declaration over
 * the `.js`, but an edge to it would leave a change to the code that runs
 * reaching nothing. Beside a stylesheet or `.json` it describes the asset the
 * import loads. So the declaration answers only where nothing else does, and
 * where it answers it answers on every file system: a name that differs from
 * the request only in case is refused on macOS as it is missed on Linux, and a
 * sibling that differs only in case does not hide the declaration on macOS.
 */

const IMPORTER = 'src/a.ts';
const DECLARATION = 'src/b.d.ts';
const PLAIN = 'plain/index.js';

const FILES: Readonly<Record<string, string>> = {
  'package.json': '{ "name": "fixture", "private": true, "type": "module" }',
  [IMPORTER]: [
    "import type { B } from './b';",
    "import { c } from './c';",
    "import { Widget } from './widget';",
    "import type { E } from './e.js';",
    'export const a: B & { e?: E } = { shared: String(c) + String(Widget) };',
  ].join('\n'),
  // Declaration-only, and importing a declaration-only sibling in turn.
  [DECLARATION]: "import type { Shared } from './shared';\nexport interface B { shared: Shared }",
  'src/shared.d.ts': 'export type Shared = string;',
  // Asked for as `./e.js`, the way a `nodenext` package writes it.
  'src/e.d.ts': 'export type E = number;',
  // Implemented beside their declarations, as a build that emits into `src` leaves them.
  'src/c.ts': 'export const c = 1;',
  'src/c.d.ts': 'export declare const c = 1;',
  'src/widget.tsx': 'export const Widget = () => null;',
  'src/widget.d.ts': 'export declare const Widget: () => null;',
  // Assets that ship a declaration of themselves.
  'src/assets.js': "import messages from './messages';\nimport './theme';\nexport default messages;",
  'src/messages.json': '{}',
  'src/messages.d.ts': 'declare const messages: object;\nexport default messages;',
  'src/theme.css': 'a { color: red; }',
  'src/theme.d.ts': 'export {};',
  // A component and the declaration of its props, named apart only by case.
  'src/Palette.tsx': "import type { Tone } from './palette';\nexport const Palette = (tone: Tone) => tone;",
  'src/palette.d.ts': 'export type Tone = string;',
  // A request that names a declaration in a case the disk does not hold.
  'src/modes.ts': "import type { Mode } from './Mode';\nexport const mode: Mode = 'dark';",
  'src/mode.d.ts': "export type Mode = 'dark';",
  // A package written in JavaScript that ships its types beside its code.
  [PLAIN]: "import { util } from './util';\nimport { format } from './format.js';\nexport const index = format(util);",
  'plain/util.js': 'export const util = 1;',
  'plain/util.d.ts': 'export declare const util: number;',
  'plain/format.js': 'export const format = (n) => String(n);',
  'plain/format.d.ts': 'export declare const format: (n: number) => string;',
};

/** Request → target, where `undefined` is a request that resolves to nothing. */
type Expected = Readonly<Record<string, Readonly<Record<string, string | undefined>>>>;

const EXPECTED: Expected = {
  [IMPORTER]: {
    './b': DECLARATION,
    './c': 'src/c.ts',
    './widget': 'src/widget.tsx',
    './e.js': 'src/e.d.ts',
  },
  [DECLARATION]: { './shared': 'src/shared.d.ts' },
  'src/assets.js': { './messages': 'src/messages.json', './theme': 'src/theme.css' },
  'src/Palette.tsx': { './palette': 'src/palette.d.ts' },
  'src/modes.ts': { './Mode': undefined },
  [PLAIN]: { './util': 'plain/util.js', './format.js': 'plain/format.js' },
};

/**
 * A declaration-only build, asked for through its manifest's extensionless
 * `main` and through a path into its `outDir`. Nothing there is a declaration
 * the checkout holds as itself, and the code beside it is a bundler's, so the
 * answer is the same before the build, after `tsc`, and after the bundler.
 */
const LIBRARY: Readonly<Record<string, string>> = {
  'package.json': '{ "name": "fixture", "private": true, "type": "module" }',
  'lib/package.json': '{ "name": "lib", "main": "dist/index" }',
  'lib/tsconfig.json':
    '{ "compilerOptions": { "rootDir": "src", "outDir": "dist", "declaration": true, "emitDeclarationOnly": true } }',
  'lib/src/index.ts': 'export const index = 1;',
  'lib/src/deep.ts': 'export const deep = 1;',
  'app/main.ts': "import { index } from '../lib';\nimport { deep } from '../lib/dist/deep';\nexport const main = index + deep;",
};
const DECLARED = {
  'lib/dist/index.d.ts': 'export declare const index = 1;',
  'lib/dist/deep.d.ts': 'export declare const deep = 1;',
};
const BUILDS: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
  ['before the build', {}],
  ['after tsc', DECLARED],
  ['after tsc and a bundler', { ...DECLARED, 'lib/dist/index.js': 'export const index = 1;', 'lib/dist/deep.js': 'export const deep = 1;' }],
];
const BUILT: Expected = { 'app/main.ts': { '../lib': undefined, '../lib/dist/deep': undefined } };

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const at = realPath(await mkdtemp(join(tmpdir(), 'variance-declarations-')));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(at, path)), { recursive: true });
    await writeFile(join(at, path), `${contents}\n`, 'utf8');
  }
  return at;
}

function oracle(root: string, from: string, request: string): string | undefined {
  return resolveTo({ resolvers: resolversFor({}), root, from: join(root, from), request, language: 'module' });
}

/** The scan, the resolver taint asks, and the native scanner, held to `expected`. */
function answers(title: string, files: () => Readonly<Record<string, string>>, dirs: readonly string[], expected: Expected) {
  describe(title, () => {
    let root: string;
    beforeAll(async () => {
      root = await fixture(files());
    });
    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('records an edge for every request that resolves, and the rest as unresolved', async () => {
      const records = await scanRelations({ root, dirs });
      for (const [file, requests] of Object.entries(expected)) {
        const record = records.find((found) => found.file === file);
        const targets = Object.values(requests).filter((target) => target !== undefined).sort();
        const missed = Object.keys(requests).filter((request) => requests[request] === undefined).sort();
        expect(record?.edges?.map((edge) => edge.to).sort() ?? [], file).toEqual(targets);
        expect(record?.unresolved ?? [], file).toEqual(missed);
      }
    });

    it('resolves the same way through the resolver taint asks', () => {
      for (const [file, requests] of Object.entries(expected)) {
        for (const [request, target] of Object.entries(requests)) {
          expect(oracle(root, file, request), `${request} from ${file}`).toBe(target);
        }
      }
    });

    it.runIf(nativeAvailable())('agrees with the native scanner on every request', () => {
      for (const [file, requests] of Object.entries(expected)) {
        const batch = native()!.scanBatch(root, [file]);
        expect(batch.targets, file).toEqual(batch.values.map((value) => oracle(root, file, value) ?? ''));
        expect(batch.targets, file).toEqual(batch.values.map((value) => requests[value] ?? ''));
      }
    });
  });
}

answers('a relative import of a declaration file', () => FILES, ['src', 'plain'], EXPECTED);

for (const [state, output] of BUILDS) {
  answers(`a request into a declaration-only build, ${state}`, () => ({ ...LIBRARY, ...output }), ['app'], BUILT);
}
