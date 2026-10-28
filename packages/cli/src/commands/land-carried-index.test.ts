import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  caseSectionsAt,
  coverageChange,
  coveringTests,
  decodeExecutionIndex,
  encodeAsSetExecutionIndex,
  encodeExecutionIndex,
  followRows,
  hunksByFile,
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

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout;

const FILE = 'src/math.ts';
const OTHER = 'src/other.ts';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const THREE = 'test/three.test.ts';

// `a` and `b`, then the same two with two lines written above them: every region keeps its address, two lines down.
// The texts are real: the edit between them is what places the held cases.
const FIRST_TEXT = 'export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n';
const MOVED_TEXT = `// written\n// above\n${FIRST_TEXT}`;
const AT_FIRST = { digest: digestString(FIRST_TEXT), module: [1, 7], a: [1, 3], b: [5, 7] } as const;
const MOVED = { digest: digestString(MOVED_TEXT), module: [1, 9], a: [3, 5], b: [7, 9] } as const;
// A comment written between `a` and `b`: inside the module's lines, outside every function, and nothing that runs.
const NOTED_TEXT = FIRST_TEXT.replace('}\n\nexport function b', '}\n\n// b answers two\nexport function b');
const NOTED = { digest: digestString(NOTED_TEXT), module: [1, 8], a: [1, 3], b: [6, 8] } as const;

type Text = typeof AT_FIRST | typeof MOVED | typeof NOTED;

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

/** The record's cases of `FILE` after a shard recorded it at `text` (the checkout's `source`) and kept no case of it. */
async function landedAt(source: string, text: Text) {
  {
    const { dir } = await published(home, { publish: false, record: wholeRecord });
    await mkdir(join(dir, 'test'), { recursive: true });
    for (const test of [ONE, TWO, THREE]) await writeFile(join(dir, test), '', 'utf8');
    const into = join(home, 'landed.bin');
    // The module is committed at its first text, which the mainline's record names, and the checkout holds the moved one.
    const mathFile = join(dir, FILE);
    await writeFile(mathFile, FIRST_TEXT, 'utf8');
    await git(dir, 'add', FILE);
    await git(dir, 'commit', '--quiet', '-m', 'math');
    const first = (await git(dir, 'rev-parse', 'HEAD')).trim();
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
      index: encodeAsSetExecutionIndex({
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
        rows(text, { module: [THREE], a: [], b: [] }),
        {
          file: OTHER,
          sourceDigest: 'other',
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: 'other', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [THREE] }],
        },
      ],
    }, {
      index: encodeAsSetExecutionIndex({ tests: [caseOf(THREE)], modules: [{ file: OTHER, blocks: [block('module', '', [1, 1], [0])] }] }),
    });
    await writeFile(mathFile, source, 'utf8');
    await landJourneys(dir, [shard], into);

    const landed = (await readTestCoverage(into)).modules.find((module) => module.file === FILE)!;
    return {
      landed,
      index: decodeExecutionIndex(caseSectionsAt(into).index!),
      base: decodeExecutionIndex(caseSectionsAt(mainline).index!),
      diff: hunksByFile(await git(dir, 'diff', '-U0', '--no-renames', 'HEAD', '--', FILE)),
    };
  }
}

const functions = (blocks: readonly { readonly kind: string; readonly name: string; readonly startLine?: number; readonly endLine?: number }[]) =>
  blocks.filter((region) => region.kind === 'function').map((region) => `${region.name} ${region.startLine}-${region.endLine}`);

describe('landJourneys over a module a shard recorded at another text and kept no case of', () => {
  it('lays the cases the record held of it onto the lines its rows were landed at', async () => {
    const { landed, index } = await landedAt(MOVED_TEXT, MOVED);

    expect(landed.sourceDigest).toBe(MOVED.digest);
    expect(functions(landed.blocks)).toEqual(['a 3-5', 'b 7-9']);
    expect(functions(index.modules.find((module) => module.file === FILE)!.blocks)).toEqual(functions(landed.blocks));
    expect(coveringTests(index, { file: FILE, line: MOVED.b[0] + 1 }).map((test) => test.id)).toEqual([caseOf(TWO).id]);
  });

  it('keeps every case of a region a comment written inside it moved, as the edit changes nothing that runs', async () => {
    const { landed, index, base, diff } = await landedAt(NOTED_TEXT, NOTED);

    expect(landed.sourceDigest).toBe(NOTED.digest);
    const module = index.modules.find((held) => held.file === FILE)!;
    expect(module.blocks.map(({ kind, name, startLine, endLine, crossings }) => [kind, name, startLine, endLine, crossings.map((crossing) => index.tests[crossing.test]!.file)]))
      .toEqual([['module', '', 1, 8, [ONE, TWO]], ['function', 'a', 1, 3, [ONE]], ['function', 'b', 6, 8, [TWO]]]);
    // The comment's line stands in the module's top level, which both tests ran.
    expect(coveringTests(index, { file: FILE, line: 5 }).map((test) => test.id).sort()).toEqual([caseOf(ONE).id, caseOf(TWO).id]);
    // Compared with the record before the edit, no test file runs less.
    const change = coverageChange(base, index, { diff });
    expect([change.lost, change.hidden, change.testFiles]).toEqual([0, 0, []]);
  });

  // FIXME: a module the run did not record, whose rows are re-cut to a text that
  // edits a body in place, keeps its held cases when no line moved: `cutAlike`
  // reads the held cut as already standing at the rows. The cases of `two`, which
  // ran `b`, stay on `b`; they should drop. Needs the landing to name the modules
  // the run laid, so a held one is followed through the edit whatever its lines.
  it.todo('keeps no case on a region edited in place, though no line moved — needs the landing to name the modules the run laid');
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
