import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { parseArgs } from '../parse.js';
import { answerConfigless, withoutConfig } from './configless.js';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';
import { shardsOutput } from './shards-command.js';

/**
 * `variance select --at-distance` over a record written to disk and a graph
 * read from a git checkout, as `test:since` reads them.
 *
 * `select-leg.test.ts` holds the leg to its partition over a hand-built
 * reading; these cases hold the same legs to what `index` and `select` measure
 * from a widget, a caller of it and a caller of that.
 */

const NEAR = 'test/near.test.ts';
const MID = 'test/mid.test.ts';
const FAR = 'test/far.test.ts';
const GHOST = 'test/ghost.test.ts';
const IDLE = 'test/idle.test.ts';
const WHOLE = [FAR, GHOST, IDLE, MID, NEAR];

describe('a leg read from a real record and a real graph', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-leg-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('cuts the selection by the hops the change travelled, as test:since does', async () => {
    const { root, head } = checkout();
    await writeTestCoverage(testCoverageFile(root), snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), WIDGET.replace("return 'a';", "return 'z';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const skipOf = async (atDistance?: { from: number; to: number }) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', ...(atDistance === undefined ? {} : { atDistance }) })).out);
    const all = await skipOf();
    const near = await skipOf({ from: 0, to: 2 });
    const end = await skipOf({ from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(all.skip).toEqual([IDLE]);
    expect(near.skip).toEqual([FAR, GHOST, IDLE]);
    expect(near.left).toEqual([FAR, GHOST]);
    expect(end.skip).toEqual([IDLE, MID, NEAR]);
    expect(end.left).toEqual([MID, NEAR]);
  });

  it('carries `--at-distance` from the command line to the leg it cuts', async () => {
    const { root, head } = checkout();
    // The command line answers from the working directory, which the system
    // reports by its real path, so the record is kept under that path.
    await writeTestCoverage(testCoverageFile(realpathSync(root)), snapshot(head));
    writeFileSync(join(root, 'src/widget.ts'), WIDGET.replace("return 'a';", "return 'z';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const parsed = parseArgs(['select', '--at-distance', '0-2', '--format', 'json']);
    if (!withoutConfig(parsed)) throw new Error('`select` answers without a config');
    let out = '';
    await answerConfigless(parsed, { out: (text) => (out += text), err: () => {} });

    expect(JSON.parse(out)).toMatchObject({ leg: { from: 0, to: 2 }, skip: [FAR, GHOST, IDLE], left: [FAR, GHOST] });
  });

  it('counts the shards of the leg it is asked for, as the leg\'s shards split it', async () => {
    const { root, head } = checkout();
    const recorded = snapshot(head);
    await writeTestCoverage(testCoverageFile(root), { ...recorded, tests: recorded.tests.map((test) => ({ ...test, duration: 60_000 })) });
    writeFileSync(join(root, 'src/widget.ts'), WIDGET.replace("return 'a';", "return 'z';"));
    writeFileSync(join(root, 'collected.txt'), `${WHOLE.join('\n')}\n`);
    process.chdir(root);
    await indexOutput({ cwd: root });

    const count = async (atDistance?: { from: number; to: number }) =>
      JSON.parse(await shardsOutput({
        cwd: root, setup: 10_000, since: head, collected: 'collected.txt', format: 'json', ...(atDistance === undefined ? {} : { atDistance }),
      }));

    expect(await count()).toMatchObject({ files: 4, skipped: 1, shards: 4 });
    expect(await count({ from: 0, to: 2 })).toMatchObject({ files: 2, skipped: 3, shards: 2, matrix: ['1/2', '2/2'] });
  });

  it('carries `--at-distance` from the command line to the count', () => {
    expect(parseArgs(['shards', '--setup', '1', '--since', 'main', '--collected', 'files.txt', '--at-distance', '0-2']))
      .toMatchObject({ atDistance: { from: 0, to: 2 } });
  });

  // A test the record holds incomplete ran cases the record did not see, and
  // one of them may call what changed. The change entered nobody here, so the
  // test is selected by being incomplete, and it is one import from the change.
  it('runs a test the record never saw whole in the leg its hops from the change put it in', async () => {
    const { root, head } = checkout({ 'src/spare.ts': SPARE, [PARTIAL]: "import { untouched } from '../src/spare';\nuntouched();\n" });
    const recorded = snapshot(head);
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      tests: [...recorded.tests, { file: PARTIAL, complete: false, preconditions: [] }],
      modules: [...recorded.modules, spareModule()],
    });
    writeFileSync(join(root, 'src/spare.ts'), SPARE.replace("return 'b';", "return 'y';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const skipOf = async (atDistance: { from: number; to: number }) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance })).out);
    const near = await skipOf({ from: 0, to: 2 });
    const end = await skipOf({ from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.skip).not.toContain(PARTIAL);
    expect(near.distances).toContainEqual(expect.objectContaining({ test: PARTIAL, hops: 1 }));
    expect(end.left).toContain(PARTIAL);
    // Said by the leg that runs it, and by no other.
    const placedIn = /never saw whole and the change did not enter (is|are) placed in this leg/;
    expect(near.notes).toContain('1 test file the record never saw whole and the change did not enter is placed in this leg by the hops it ran to a changed file');
    expect(end.notes.filter((note: string) => placedIn.test(note))).toEqual([]);
  });

  // A file whose every case skipped, such as a browser file with no page built,
  // is recorded incomplete with only the modules it loaded. When an edit lands
  // in one of those, it runs at its hops.
  it('runs a file whose every case skipped in the leg of its hops to a changed file it loaded', async () => {
    const LOADED = 'test/loaded.chromium.test.ts';
    const { root, head } = checkout({
      'src/spare.ts': SPARE,
      [LOADED]: "import { spare } from '../src/spare';\nit.skip('spare', () => spare());\n",
    });
    const recorded = snapshot(head);
    const spare = spareModule();
    await writeTestCoverage(testCoverageFile(root), {
      ...recorded,
      tests: [...recorded.tests, { file: LOADED, complete: false, preconditions: [] }],
      modules: [...recorded.modules, { ...spare, blocks: spare.blocks.map((block) => ({ ...block, testFiles: [], loadedBy: [LOADED] })) }],
    });
    writeFileSync(join(root, 'src/spare.ts'), SPARE.replace("return 'b';", "return 'y';"));
    process.chdir(root);
    await indexOutput({ cwd: root });

    const skipOf = async (atDistance: { from: number; to: number }) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance })).out);
    const near = await skipOf({ from: 0, to: 2 });
    const end = await skipOf({ from: 3, to: Number.MAX_SAFE_INTEGER });

    expect(near.distances).toContainEqual(expect.objectContaining({ test: LOADED, hops: 1 }));
    expect(near.skip).not.toContain(LOADED);
    expect(end.left).toContain(LOADED);
  });

  // 8633dd2a took these out of `0-2` for their browser start-up; placed by hops, they are back.
  it.todo(
    'pays no browser start-up in `0-2` for a file whose every case skipped, while a test a partial run demoted keeps its hops — needs the record to tell a file whose every case skipped from a test a partial run demoted, and `verify:near` timings to say whether the start-up is paid again',
  );
});

const WIDGET = ['export function widget(): string {', "  return 'a';", '}', ''].join('\n');
const CALLER = ["import { widget } from './widget';", 'export const caller = (): string => widget();', ''].join('\n');
/** Two functions: a test that did not run whole entered the first, and nothing entered the second. */
const SPARE = ['export function untouched(): string {', "  return 'a';", '}', 'export function spare(): string {', "  return 'b';", '}', ''].join('\n');
const PARTIAL = 'test/partial.test.ts';
const OUTER = ["import { caller } from './caller';", 'export const outer = (): string => caller();', ''].join('\n');

/** A widget, a caller of it and a caller of that, with one test at each distance and two more. */
function checkout(extra: Readonly<Record<string, string>> = {}): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-leg-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const files: Record<string, string> = {
    'src/widget.ts': WIDGET,
    'src/caller.ts': CALLER,
    'src/outer.ts': OUTER,
    [NEAR]: "import { widget } from '../src/widget';\nwidget();\n",
    [MID]: "import { caller } from '../src/caller';\ncaller();\n",
    [FAR]: "import { outer } from '../src/outer';\nouter();\n",
    // Loads the widget by a path no import names, so no executed path is measured.
    [GHOST]: "await import(['..', 'src', 'widget'].join('/'));\n",
    [IDLE]: 'export {};\n',
    ...extra,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

/** One module whose every region ran under `testFiles`; `named` is a function spanning the whole text. */
function moduleOf(file: string, text: string, lines: number, testFiles: readonly string[], named?: string): TestCoverage['modules'][number] {
  const region = { source: true, startLine: 1, endLine: lines, testFiles: [...testFiles] };
  return {
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [
      { ...region, ordinal: 0, kind: 'module', digest: digestString(file), name: file, path: 'module' },
      ...(named === undefined
        ? []
        : [{ ...region, ordinal: 1, kind: 'function' as const, owner: 0, digest: digestString(named), name: named, path: named }]),
    ],
  };
}

function snapshot(commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: WHOLE.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      moduleOf('src/widget.ts', WIDGET, 3, [FAR, GHOST, MID, NEAR], 'widget'),
      moduleOf('src/caller.ts', CALLER, 2, [FAR, MID]),
      moduleOf('src/outer.ts', OUTER, 2, [FAR]),
    ],
  };
}

/** `src/spare.ts`, as a run that skipped some of `PARTIAL`'s cases recorded it. */
function spareModule(): TestCoverage['modules'][number] {
  const block = { source: true, testFiles: [PARTIAL] };
  return {
    file: 'src/spare.ts',
    sourceDigest: digestString(SPARE),
    instrumented: true,
    blocks: [
      { ...block, ordinal: 0, kind: 'module', digest: digestString('src/spare.ts'), name: 'src/spare.ts', path: 'module', startLine: 1, endLine: 6 },
      { ...block, ordinal: 1, kind: 'function', owner: 0, digest: digestString('untouched'), name: 'untouched', path: 'untouched', startLine: 1, endLine: 3 },
      { ...block, ordinal: 2, kind: 'function', owner: 0, digest: digestString('spare'), name: 'spare', path: 'spare', startLine: 4, endLine: 6, testFiles: [] },
    ],
  };
}
