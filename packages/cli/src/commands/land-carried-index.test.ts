import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  caseSectionsAt,
  coveringTests,
  decodeExecutionIndex,
  encodeExecutionIndex,
  followRows,
  readTestCoverage,
  writeTestCoverage,
  type ExecutionBlock,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A record whose case index holds a module, landed over by a shard that
 * recorded that module at another text and kept no case of it. The fold's rows
 * of the module stand at the shard's text, and the cases the record held of it
 * are asked by line, so they must stand there too.
 */

const FILE = 'src/math.ts';
const OTHER = 'src/other.ts';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const THREE = 'test/three.test.ts';

// `a` and `b`, then the same two with two lines written above them: every region keeps its address, two lines down.
const AT_FIRST = { digest: 'first', module: [1, 7], a: [1, 3], b: [5, 7] } as const;
const MOVED = { digest: 'moved', module: [1, 9], a: [3, 5], b: [7, 9] } as const;

type Text = typeof AT_FIRST | typeof MOVED;

/** `FILE`'s rows over `text`, with the tests that entered each region. */
function rows(text: Text, entered: { readonly module: readonly string[]; readonly a: readonly string[]; readonly b: readonly string[] }): TestCoverage['modules'][number] {
  const region = (ordinal: number, name: 'a' | 'b') => ({
    ordinal, kind: 'function' as const, owner: 0, digest: name, name, path: name,
    startLine: text[name][0], endLine: text[name][1], source: true, testFiles: [...entered[name]],
  });
  return {
    file: FILE,
    sourceDigest: text.digest,
    instrumented: true,
    blocks: [
      { ordinal: 0, kind: 'module', digest: 'module', name: '', path: '', startLine: text.module[0], endLine: text.module[1], source: true, testFiles: [...entered.module] },
      region(1, 'a'),
      region(2, 'b'),
    ],
  };
}

const caseOf = (file: string) => ({ id: `${file} > runs`, file, name: 'runs', stopped: false });

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-carried-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('landJourneys over a module a shard recorded at another text and kept no case of', () => {
  it('lays the cases the record held of it onto the lines its rows were landed at', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    await mkdir(join(dir, 'test'), { recursive: true });
    for (const test of [ONE, TWO, THREE]) await writeFile(join(dir, test), '', 'utf8');
    const into = join(home, 'landed.bin');
    const whole = (file: string) => ({ file, complete: true, preconditions: [] });
    const block = (kind: string, name: string, [startLine, endLine]: readonly [number, number], tests: readonly number[]): ExecutionBlock =>
      ({ kind, name, path: name, startLine, endLine, source: true, crossings: tests.map((test) => ({ test, distance: 0 })) });

    // The record: `one` runs `a` and `two` runs `b`, both cut at the first text.
    const mainline = join(home, 'mainline.bin');
    await writeTestCoverage(mainline, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [whole(ONE), whole(TWO)],
      modules: [rows(AT_FIRST, { module: [ONE, TWO], a: [ONE], b: [TWO] })],
    }, {
      index: encodeExecutionIndex({
        tests: [caseOf(ONE), caseOf(TWO)],
        modules: [{
          file: FILE,
          blocks: [block('module', '', AT_FIRST.module, [0, 1]), block('function', 'a', AT_FIRST.a, [0]), block('function', 'b', AT_FIRST.b, [1])],
        }],
      }),
    });
    await landJourneys(dir, [mainline], into);

    // A shard whose `three` loaded the module at the moved text; its seam kept a case of `three` in `OTHER` alone.
    const shard = join(home, 'shard.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [whole(THREE)],
      modules: [
        rows(MOVED, { module: [THREE], a: [], b: [] }),
        {
          file: OTHER,
          sourceDigest: 'other',
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: 'other', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [THREE] }],
        },
      ],
    }, {
      index: encodeExecutionIndex({ tests: [caseOf(THREE)], modules: [{ file: OTHER, blocks: [block('module', '', [1, 1], [0])] }] }),
    });
    await landJourneys(dir, [shard], into);

    const functions = (blocks: readonly { readonly kind: string; readonly name: string; readonly startLine?: number; readonly endLine?: number }[]) =>
      blocks.filter((region) => region.kind === 'function').map((region) => `${region.name} ${region.startLine}-${region.endLine}`);
    const landed = (await readTestCoverage(into)).modules.find((module) => module.file === FILE)!;
    const index = decodeExecutionIndex(caseSectionsAt(into).index!);
    expect(landed.sourceDigest).toBe(MOVED.digest);
    expect(functions(landed.blocks)).toEqual(['a 3-5', 'b 7-9']);
    expect(functions(index.modules.find((module) => module.file === FILE)!.blocks)).toEqual(functions(landed.blocks));
    expect(coveringTests(index, { file: FILE, line: MOVED.b[0] + 1 }).map((test) => test.id)).toEqual([caseOf(TWO).id]);
  });
});

describe('followRows over a held index in the row spelling', () => {
  it('leaves the index as it is, as a landing does not lay over that spelling', () => {
    const block = (kind: string, name: string, [startLine, endLine]: readonly [number, number], tests: readonly number[]): ExecutionBlock =>
      ({ kind, name, path: name, startLine, endLine, source: true, crossings: tests.map((test) => ({ test, distance: 0 })) });
    const sections = {
      index: encodeExecutionIndex({
        tests: [caseOf(ONE), caseOf(TWO)],
        modules: [{ file: FILE, blocks: [block('module', '', AT_FIRST.module, [0, 1]), block('function', 'a', AT_FIRST.a, [0]), block('function', 'b', AT_FIRST.b, [1])] }],
      }),
    };

    const followed = followRows(sections, { modules: [rows(MOVED, { module: [], a: [], b: [] })] }, new Map([[FILE, AT_FIRST.digest]]));

    expect(followed).toBe(sections);
  });
});
