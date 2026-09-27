import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packagesAround, recordedCases } from './orient.js';
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
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-orient-cache-'));
  root = mkdtempSync(join(tmpdir(), 'va-orient-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  delete process.env['XDG_CACHE_HOME'];
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

describe('the packages around some files', () => {
  it('is absent, with the index it looked for, when no index was ever published', () => {
    expect(packagesAround(root, ['src/api.ts'], { rows: 5, names: 4 })).toEqual({ index: sourceIndexPath(root) });
  });
});
