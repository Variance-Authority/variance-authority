import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { journeysAround, prepareJourneys, type JourneysAnswer } from './journeys.js';
import { updateSourceIndex } from './published.js';
import { CrossingSets } from './test-selection/crossing-sets.js';
import { encodeSetExecutionIndex } from './test-selection/execution-set-format.js';
import { testCoverageFile } from './test-selection/record-location.js';

/**
 * How a recorded case's call reaches the function it ran, for each shape of
 * import a test suite writes: through the test runner's own module mapping,
 * through `tsconfig` paths, from a package's build to its source, by a
 * workspace package's name, and by a relative path; and what the walk answers
 * when the source does not bring the call to that function at all. The index
 * reads no runner config, so a name only the runner maps is one the source does
 * not resolve: the walk places that call from the recording, on the one function
 * the case ran under the imported name, and counts it as ambiguous when the case
 * ran several. One case per checkout, one call, and the functions it ran. The
 * answer is how many of those functions the walk found a caller for, how many
 * calls it placed from the recording or left ambiguous, and the caller it found
 * for the one asked about. The checkouts are small copies of the shapes Material
 * UI and Docusaurus use.
 */

/** A file of functions, each three lines long, so the `n`th spans lines `3n + 1` to `3n + 3`. */
const functions = (...names: readonly string[]): string => names.map((name) => `export function ${name}(value) {\n  return value;\n}\n`).join('');

/** A test file with one case, `runs`, that calls `called` as `imports` brought it in. */
const test = (imports: string, called: string): string => `${imports}\nit('runs', () => ${called}('x'));\n`;

/** A function the recorder wrote where `functions` would not place it. */
interface Block {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

interface Ran {
  readonly file: string;
  /** Every function the file holds, in order: a name is the `n`th of `functions`. */
  readonly functions: readonly (string | Block)[];
  /** The ones the case entered. */
  readonly entered: readonly string[];
}

let root: string;

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-journeys-imports-cache-'));
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-journeys-imports-')));
});

afterEach(() => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function checkout(files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries({ '.gitignore': 'node_modules\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
}

/** The Vite this repository installs, where the checkout's own `node_modules` would hold it. */
function installVite(): void {
  const vite = dirname(createRequire(import.meta.url).resolve('vite/package.json'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(vite, join(root, 'node_modules', 'vite'), 'dir');
}

/** Each workspace package linked under its name, as an install leaves it. */
function installWorkspaces(packages: Readonly<Record<string, string>>): void {
  for (const [name, directory] of Object.entries(packages)) {
    mkdirSync(dirname(join(root, 'node_modules', name)), { recursive: true });
    symlinkSync(join(root, directory), join(root, 'node_modules', name), 'dir');
  }
}

function recording(testFile: string, ran: readonly Ran[]): Buffer {
  const tests = [{ id: 'case > runs', file: testFile, name: 'runs' }];
  const sets = new CrossingSets(tests.length);
  return encodeSetExecutionIndex({
    tests,
    modules: ran.map(({ file, functions: written, entered }) => {
      const held = written.map((block, at) => (typeof block === 'string' ? { name: block, start: at * 3 + 1, end: at * 3 + 3 } : block));
      return {
        file,
        blocks: [
          { kind: 'module', name: '', path: '', startLine: 1, endLine: Math.max(...held.map(({ end }) => end)), source: true },
          ...held.map(({ name, start, end }) => ({ kind: 'function', name, path: name, startLine: start, endLine: end, source: true })),
        ],
        called: Uint32Array.from([sets.intern([]), ...held.map(({ name }) => sets.intern(entered.includes(name) ? [0] : []))]),
        loaded: Uint8Array.from([1, ...held.map(() => 0)]),
      };
    }),
    sets: sets.pool(),
  });
}

/** The journeys prepared over the checkout: how many functions the case ran, how many have a caller, and the callers of the function at `asked:2`. */
async function walk(testFile: string, ran: readonly Ran[], asked: string) {
  await updateSourceIndex(root);
  const at = `${testCoverageFile(root)}.cases.bin`;
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, recording(testFile, ran));
  const [only] = await prepareJourneys(root);
  if (only === undefined || !('prepared' in only)) return only;
  const { functionsEntered: entered, placed, recorded, ambiguous, ambiguousCases } = only.prepared;
  const [around] = journeysAround(root, [{ file: asked, line: 2 }]) as [{ answer: JourneysAnswer }?];
  return { entered, placed, recorded, ambiguous, ambiguousCases, callers: around?.answer.files[0]?.focus?.callers };
}

/** The case ran `get`, the only function of `src/api.ts`. */
const ranGet: readonly Ran[] = [{ file: 'src/api.ts', functions: ['get'], entered: ['get'] }];

describe('a call reaches the function its case ran', () => {
  it('by a name the test runner maps, as Material UI sends a package name to its source directory, from the recording', async () => {
    installVite();
    checkout({
      'package.json': JSON.stringify({ name: 'material-ui', private: true, workspaces: ['packages/*'] }),
      'vitest.config.ts': `export default { resolve: { alias: { '@mui/utils': ${JSON.stringify(join(root, 'packages/mui-utils/src'))} } } };\n`,
      'packages/mui-utils/package.json': JSON.stringify({ name: '@mui/utils', main: './build/index.js' }),
      'packages/mui-utils/src/index.js': functions('capitalize'),
      'packages/mui-material/test/capitalize.test.js': test("import { capitalize } from '@mui/utils';", 'capitalize'),
    });
    installWorkspaces({ '@mui/utils': 'packages/mui-utils' });

    expect(await walk('packages/mui-material/test/capitalize.test.js', [
      { file: 'packages/mui-utils/src/index.js', functions: ['capitalize'], entered: ['capitalize'] },
    ], 'packages/mui-utils/src/index.js')).toEqual({ entered: 1, placed: 1, recorded: 1, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'recorded' }] });
  });

  it('by a name the test runner maps to a file path relative to its config, from the recording', async () => {
    installVite();
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'vitest.config.ts': "export default { resolve: { alias: { '@api': './src/api.ts' } } };\n",
      'src/api.ts': functions('get'),
      'test/api.test.ts': test("import { get } from '@api';", 'get'),
    });

    expect(await walk('test/api.test.ts', ranGet, 'src/api.ts')).toEqual({ entered: 1, placed: 1, recorded: 1, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'recorded' }] });
  });

  it('through `tsconfig` paths', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
      'src/api.ts': functions('get'),
      'test/api.test.ts': test("import { get } from '@app/api';", 'get'),
    });

    expect(await walk('test/api.test.ts', ranGet, 'src/api.ts')).toEqual({ entered: 1, placed: 1, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'static' }] });
  });

  it('from a package\'s build to its source, as a Docusaurus package names `lib/` and runs `src/`', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'docusaurus', private: true, workspaces: ['packages/*'] }),
      'packages/docusaurus-utils/package.json': JSON.stringify({ name: '@docusaurus/utils', main: './lib/index.js', types: './lib/index.d.ts' }),
      'packages/docusaurus-utils/tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'lib', rootDir: 'src' } }),
      'packages/docusaurus-utils/src/index.ts': functions('posixPath'),
      'packages/docusaurus/package.json': JSON.stringify({ name: '@docusaurus/core', dependencies: { '@docusaurus/utils': '*' } }),
      'packages/docusaurus/src/__tests__/paths.test.ts': test("import { posixPath } from '@docusaurus/utils';", 'posixPath'),
    });
    installWorkspaces({ '@docusaurus/utils': 'packages/docusaurus-utils', '@docusaurus/core': 'packages/docusaurus' });

    expect(await walk('packages/docusaurus/src/__tests__/paths.test.ts', [
      { file: 'packages/docusaurus-utils/src/index.ts', functions: ['posixPath'], entered: ['posixPath'] },
    ], 'packages/docusaurus-utils/src/index.ts')).toEqual({ entered: 1, placed: 1, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'static' }] });
  });

  it('by a workspace package\'s name', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'repo', private: true, workspaces: ['packages/*'] }),
      'packages/lib/package.json': JSON.stringify({ name: '@t/lib', main: './src/index.ts' }),
      'packages/lib/src/index.ts': functions('get'),
      'packages/app/package.json': JSON.stringify({ name: '@t/app', dependencies: { '@t/lib': '*' } }),
      'packages/app/test/get.test.ts': test("import { get } from '@t/lib';", 'get'),
    });
    installWorkspaces({ '@t/lib': 'packages/lib', '@t/app': 'packages/app' });

    expect(await walk('packages/app/test/get.test.ts', [
      { file: 'packages/lib/src/index.ts', functions: ['get'], entered: ['get'] },
    ], 'packages/lib/src/index.ts')).toEqual({ entered: 1, placed: 1, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'static' }] });
  });

  it('by a relative path', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/api.ts': functions('get'),
      'test/api.test.ts': test("import { get } from '../src/api.js';", 'get'),
    });

    expect(await walk('test/api.test.ts', ranGet, 'src/api.ts')).toEqual({ entered: 1, placed: 1, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'static' }] });
  });
});

describe('a call the source does not bring to the function its case ran', () => {
  it('when nothing in the checkout resolves the import', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/api.ts': functions('get'),
      'test/api.test.ts': test("import { get } from 'api';", 'get'),
    });

    expect(await walk('test/api.test.ts', ranGet, 'src/api.ts')).toEqual({ entered: 1, placed: 1, recorded: 1, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'recorded' }] });
  });

  it('when the case ran more than one function under the imported name', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/api.ts': functions('get'),
      'src/other.ts': functions('get'),
      'test/api.test.ts': test("import { get } from 'api';", 'get'),
    });

    expect(await walk('test/api.test.ts', [...ranGet, { file: 'src/other.ts', functions: ['get'], entered: ['get'] }], 'src/api.ts'))
      .toEqual({ entered: 2, placed: 0, recorded: 0, ambiguous: 1, ambiguousCases: 1, callers: [] });
  });

  it('when a runner config would throw as it is evaluated, as Material UI\'s does on `__dirname`, which the index never evaluates', async () => {
    installVite();
    const evaluated = join(mkdtempSync(join(tmpdir(), 'va-journeys-imports-evaluated-')), 'evaluated');
    checkout({
      'package.json': JSON.stringify({ name: 'material-ui', private: true }),
      'test/regressions/vitest.config.ts': `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(evaluated)}, '');\nthrow new ReferenceError('__dirname is not defined');\n`,
      'src/api.ts': functions('get'),
      'test/api.test.ts': test("import { get } from '../src/api.js';", 'get'),
    });

    expect(await walk('test/api.test.ts', ranGet, 'src/api.ts')).toEqual({ entered: 1, placed: 1, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'static' }] });
    expect(existsSync(evaluated)).toBe(false);
  });
});

describe('a call the recording does not place', () => {
  it('when its import leads to a function the case did not enter, as a branch the case did not take, though another file it ran exports the name', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/api.ts': functions('get'),
      'lib/api.js': functions('get'),
      'test/api.test.ts': test("import { get } from '../lib/api.js';", 'get'),
    });

    expect(await walk('test/api.test.ts', [...ranGet, { file: 'lib/api.js', functions: ['get'], entered: [] }], 'src/api.ts'))
      .toEqual({ entered: 1, placed: 0, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [] });
  });

  it('when it imports a Node builtin whose name a function the case ran is exported under', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/names.ts': functions('basename'),
      'test/names.test.ts': test("import { basename } from 'path';", 'basename'),
    });

    expect(await walk('test/names.test.ts', [{ file: 'src/names.ts', functions: ['basename'], entered: ['basename'] }], 'src/names.ts'))
      .toEqual({ entered: 1, placed: 0, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [] });
  });

  it('when it imports an installed package no workspace holds, whose name a function the case ran is exported under', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true, dependencies: { lodash: '*' } }),
      'src/text.ts': functions('capitalize'),
      'test/text.test.ts': test("import { capitalize } from 'lodash';", 'capitalize'),
    });

    expect(await walk('test/text.test.ts', [{ file: 'src/text.ts', functions: ['capitalize'], entered: ['capitalize'] }], 'src/text.ts'))
      .toEqual({ entered: 1, placed: 0, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [] });
  });

  it('when the function the case ran under the imported name is not exported', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/api.ts': 'function get(value) {\n  return value;\n}\n',
      'test/api.test.ts': test("import { get } from 'api';", 'get'),
    });

    expect(await walk('test/api.test.ts', ranGet, 'src/api.ts')).toEqual({ entered: 1, placed: 0, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [] });
  });

  it('when it names a workspace package, on a function another package exports', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'repo', private: true, workspaces: ['packages/*'] }),
      'packages/lib/package.json': JSON.stringify({ name: '@t/lib', main: './build/index.js' }),
      'packages/lib/src/index.ts': functions('get'),
      'packages/other/package.json': JSON.stringify({ name: '@t/other' }),
      'packages/other/src/index.ts': functions('get'),
      'packages/app/package.json': JSON.stringify({ name: '@t/app', dependencies: { '@t/lib': '*' } }),
      'packages/app/test/get.test.ts': test("import { get } from '@t/lib';", 'get'),
    });

    expect(await walk('packages/app/test/get.test.ts', [
      { file: 'packages/lib/src/index.ts', functions: ['get'], entered: [] },
      { file: 'packages/other/src/index.ts', functions: ['get'], entered: ['get'] },
    ], 'packages/other/src/index.ts')).toEqual({ entered: 1, placed: 0, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [] });
  });
});

describe('a call the recording places, and what it does not override', () => {
  it('a default import, on the function its module exports as default under another name', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/class-names.ts': 'export default function classNames(value) {\n  return value;\n}\n',
      'test/class-names.test.ts': test("import cx from 'class-names';", 'cx'),
    });

    expect(await walk('test/class-names.test.ts', [{ file: 'src/class-names.ts', functions: ['classNames'], entered: ['classNames'] }], 'src/class-names.ts'))
      .toEqual({ entered: 1, placed: 1, recorded: 1, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'recorded' }] });
  });

  it('`new Foo()`, on the constructor the case ran, when two functions it ran are exported as `Foo`', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/a.ts': functions('Foo'),
      'src/b.ts': functions('Foo'),
      'src/c.ts': 'class Foo {\n  constructor(value) {}\n}\n',
      'test/foo.test.ts': test("import { Foo } from 'models';", 'new Foo'),
    });

    expect(await walk('test/foo.test.ts', [
      { file: 'src/a.ts', functions: ['Foo'], entered: ['Foo'] },
      { file: 'src/b.ts', functions: ['Foo'], entered: ['Foo'] },
      { file: 'src/c.ts', functions: [{ name: 'Foo/constructor', start: 2, end: 2 }], entered: ['Foo/constructor'] },
    ], 'src/c.ts')).toEqual({ entered: 3, placed: 1, recorded: 0, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, known: 'new' }] });
  });

  it('a call the relations also bring to the function, which keeps the caller they name', async () => {
    checkout({
      'package.json': JSON.stringify({ name: 'app', private: true }),
      'src/api.ts': functions('get'),
      'src/run.ts': "import { get } from './api.js';\nexport function run(value) {\n  return get(value);\n}\n",
      'test/api.test.ts': "import { get } from 'api';\nimport { run } from '../src/run.js';\nit('runs', () => {\n  get('x');\n  run('x');\n});\n",
    });

    expect(await walk('test/api.test.ts', [
      ...ranGet,
      { file: 'src/run.ts', functions: [{ name: 'run', start: 2, end: 4 }], entered: ['run'] },
    ], 'src/api.ts')).toEqual({ entered: 2, placed: 2, recorded: 1, ambiguous: 0, ambiguousCases: 0, callers: [{ cases: 1, file: 'src/run.ts', known: 'observed', line: 2, name: 'run' }] });
  });
});
