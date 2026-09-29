import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dependenciesAround, packagesAround, recordedCases } from './orient.js';
import { updateSourceIndex } from './published.js';
import { sourceIndexPath } from './source-index.js';
import { CrossingSets } from './test-selection/crossing-sets.js';
import { encodeSetExecutionIndex } from './test-selection/execution-set-format.js';
import { testCoverageFile } from './test-selection/record-location.js';

/**
 * The two readings `variance ask orient` is made of, asked of the addon over a
 * checkout that has published what each one reads — and over one that has not,
 * which is answered with where it looked rather than with nothing.
 */

const TESTS = [
  { id: 'card > a', file: 'test/card.test.ts', name: 'a' },
  { id: 'plain > a', file: 'test/plain.test.ts', name: 'a' },
  { id: 'wire > a', file: 'test/wire.test.ts', name: 'a' },
  { id: 'plain > b', file: 'test/plain.test.ts', name: 'b' },
];

const region = (kind: string, name: string, startLine: number, endLine: number) =>
  ({ kind, name, path: name, startLine, endLine, source: true });

/** `api.ts` ran under three cases in one function and one more in another; `idle.ts` loaded and ran under none. */
function recording(): Buffer {
  const sets = new CrossingSets(TESTS.length);
  return encodeSetExecutionIndex({
    tests: TESTS,
    modules: [
      {
        file: 'src/api.ts',
        blocks: [region('module', '', 1, 10), region('function', 'get', 3, 6), region('function', 'put', 7, 9)],
        called: Uint32Array.of(sets.intern([]), sets.intern([2, 0, 1]), sets.intern([3, 0])),
        loaded: Uint8Array.of(1, 0, 0),
      },
      {
        file: 'src/idle.ts',
        blocks: [region('function', 'rest', 1, 2)],
        called: Uint32Array.of(sets.intern([])),
        loaded: Uint8Array.of(0),
      },
    ],
    sets: sets.pool(),
  });
}

let root: string;

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-orient-cache-'));
  root = mkdtempSync(join(tmpdir(), 'va-orient-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

function record(bytes: Uint8Array): string {
  const at = `${testCoverageFile(root)}.cases.bin`;
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, bytes);
  return at;
}

describe('the recorded cases around some files', () => {
  it('counts the cases that ran each file, names the first in code-unit order, and says which file has no row', () => {
    const at = record(recording());

    expect(recordedCases(root, ['src/api.ts', 'src/idle.ts', 'src/none.ts'], 2)).toEqual([
      {
        recording: at,
        files: [
          {
            file: 'src/api.ts',
            cases: 4,
            // Its module region ran as it loaded, under cases the recording does not name.
            loaded: true,
            titles: [{ file: 'test/card.test.ts', name: 'a' }, { file: 'test/plain.test.ts', name: 'a' }],
            declaredNames: [],
          },
          { file: 'src/idle.ts', cases: 0, loaded: false, titles: [], declaredNames: [] },
          // No row is a file nobody observed, which is not a file no case ran.
          { file: 'src/none.ts', titles: [], declaredNames: [] },
        ],
      },
    ]);
  });

  it('answers a test file with the cases it declares, which no module row holds', () => {
    record(recording());

    const [only] = recordedCases(root, ['test/plain.test.ts'], 1);

    expect(only && 'files' in only ? only.files : undefined).toEqual([
      { file: 'test/plain.test.ts', titles: [], declared: 2, declaredNames: ['a'] },
    ]);
  });

  it('says where it looked when nothing is recorded, instead of answering with no cases', () => {
    const [only] = recordedCases(root, ['src/api.ts'], 2);

    expect(only).toEqual({ recording: `${testCoverageFile(root)}.cases.bin`, unread: 'nothing is recorded there' });
  });

  it('says why a recording it cannot read is left out', () => {
    record(Buffer.from('not a recording'));

    const [only] = recordedCases(root, ['src/api.ts'], 2);

    expect(only && 'unread' in only ? only.unread : undefined).toMatch(/cannot read journey file/u);
  });
});

describe('the cases that loaded a module', () => {
  it('names the cases whose test files import a file that ran only while its module evaluated, through a file between', async () => {
    const files = {
      'package.json': JSON.stringify({ name: 'fixture' }),
      'src/flags.ts': 'export const flags = { on: true };\n',
      'src/mid.ts': "import { flags } from './flags.js';\nexport const mid = flags;\n",
      'test/direct.test.ts': "import { flags } from '../src/flags.js';\nexport const direct = flags;\n",
      'test/through.test.ts': "import { mid } from '../src/mid.js';\nexport const through = mid;\n",
      'test/apart.test.ts': 'export const apart = 1;\n',
    };
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
    await updateSourceIndex(root);
    const sets = new CrossingSets(3);
    record(encodeSetExecutionIndex({
      tests: [
        { id: 'apart > x', file: 'test/apart.test.ts', name: 'x' },
        { id: 'direct > y', file: 'test/direct.test.ts', name: 'y' },
        { id: 'through > z', file: 'test/through.test.ts', name: 'z' },
      ],
      modules: [{
        file: 'src/flags.ts',
        blocks: [region('module', '', 1, 1)],
        called: Uint32Array.of(sets.intern([])),
        loaded: Uint8Array.of(1),
      }],
      sets: sets.pool(),
    }));

    const [only] = recordedCases(root, ['src/flags.ts'], 5);

    expect(only && 'files' in only ? only.files : undefined).toEqual([
      {
        file: 'src/flags.ts',
        cases: 2,
        loaded: true,
        loaders: 2,
        titles: [{ file: 'test/direct.test.ts', name: 'y' }, { file: 'test/through.test.ts', name: 'z' }],
        declaredNames: [],
      },
    ]);
  });
});

describe('the packages around some files', () => {
  it('is absent, with the index it looked for, when no index was ever published', () => {
    expect(packagesAround(root, ['src/api.ts'], { rows: 5, names: 4 })).toEqual({ index: sourceIndexPath(root) });
  });
});

describe('external dependencies along local imports', () => {
  it('uses code to separate areas when root declarations and root:* supply the install', async () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'fixture', workspaces: ['packages/*'],
        dependencies: { 'state-kit': '2.0.0', 'intl-engine': '5.0.0', 'fancy-lib': '1.0.0', 'unused-root': '1.0.0' },
      }),
      'packages/settings/package.json': JSON.stringify({ name: '@project/settings', dependencies: { 'state-kit': 'root:*', 'unused-local': 'root:*' } }),
      'packages/settings/src/page.ts': "import { createStore } from 'state-kit';\nimport { local } from './local.js';\nexport const page = [createStore, local];\n",
      'packages/settings/src/local.ts': "import { translate } from 'intl-engine';\nexport const local = translate;\n",
      'packages/tooling/package.json': JSON.stringify({ name: '@project/tooling', dependencies: { 'fancy-lib': 'root:*' } }),
      'packages/tooling/src/run.ts': "import { build } from 'fancy-lib';\nexport const run = build;\n",
    };
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
    await updateSourceIndex(root);

    const answer = dependenciesAround(root, ['packages/settings/src/page.ts'], { rows: 8, names: 3 }).orientation;
    expect(answer?.dependencies.map((dependency) => dependency.package)).toEqual(['intl-engine', 'state-kit']);
    expect(answer?.dependencies.find((dependency) => dependency.package === 'state-kit')).toMatchObject({
      files: 1, imports: 1,
      sites: [{ file: 'packages/settings/src/page.ts', line: 1, names: ['createStore'], distance: 0 }],
      declaredIn: ['packages/settings/package.json', 'root package.json'],
    });
    expect(answer?.dependencies.find((dependency) => dependency.package === 'intl-engine')).toMatchObject({
      sites: [{ file: 'packages/settings/src/local.ts', line: 1, names: ['translate'], distance: 1 }],
      declaredIn: ['root package.json'],
    });
    expect(answer?.declaredOnly).toEqual(['unused-local']);
    expect(answer?.unread).toBe(0);
  });
});
