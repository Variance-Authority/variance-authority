import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { journeyMap, journeyMaps } from './journeys.js';
import { CrossingSets } from './test-selection/crossing-sets.js';
import { encodeSetExecutionIndex } from './test-selection/execution-set-format.js';
import { encodeTestCoverage } from './test-selection/format.js';
import { testCoverageFile } from './test-selection/record-location.js';

/**
 * `journeyMap` through the built addon, for a file the recording keeps a row
 * for and for every kind of file it keeps none for: each answer names what the
 * checkout's owners said about the file, and says no test loaded it only where
 * all of them agree one could have.
 *
 * `test/a.test.ts`'s two cases run `src/a.ts`, `src/m.ts` and `src/z.ts`, and
 * one of them `src/y.ts`; `test/b.test.ts` runs `src/a.ts`, `src/m.ts` and
 * `main.ts`, and `test/idle.test.ts` runs nothing.
 */

let root: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const commit = () => git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'fixture');

function write(path: string, text = 'export const held = 1;\n'): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** `under` moves every module below the root under that directory, so a directory can hold rows only in its subdirectories. */
function shared(atRoot: boolean, under = ''): Buffer {
  const tests = [
    { id: 'a > one', file: 'test/a.test.ts', name: 'one' },
    { id: 'a > two', file: 'test/a.test.ts', name: 'two' },
    { id: 'b > one', file: 'test/b.test.ts', name: 'one' },
    { id: 'idle > one', file: 'test/idle.test.ts', name: 'one' },
  ];
  const sets = new CrossingSets(tests.length);
  const region = (kind: string, name: string) => ({ kind, name, path: name, startLine: 1, endLine: 3, source: true });
  const module = (file: string, cases: readonly number[]) => ({
    file: file.includes('/') ? `${under}${file}` : file,
    blocks: [region('module', ''), region('function', 'run')],
    called: Uint32Array.of(sets.intern([]), sets.intern([...cases])),
    loaded: Uint8Array.of(1, 0),
  });
  return encodeSetExecutionIndex({
    tests,
    modules: [
      ...(atRoot ? [module('main.ts', [2])] : []),
      module('src/a.ts', [0, 1, 2]),
      module('src/m.ts', [0, 1, 2]),
      module('src/y.ts', [0]),
      module('src/z.ts', [0, 1]),
    ],
    sets: sets.pool(),
  });
}

/** Record `shared()` at the commit that adds `files`, and return that commit's first twelve digits. */
function recordedAt(files: readonly string[], { atRoot = true, under = '' } = {}): string {
  for (const file of files) write(file);
  git('add', '.');
  commit();
  const at = testCoverageFile(root);
  const made = git('rev-parse', 'HEAD').trim();
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests: [], modules: [], commit: made }));
  writeFileSync(`${at}.cases.bin`, shared(atRoot, under));
  return made.slice(0, 12);
}

const cannot = (file: string) => `The recording cannot say whether a test loaded ${file}: `;

/** The finding, which only a tracked module with rows beside it at the recording's commit gets. */
const noneLoaded = (file: string, at: string, rows: string) =>
  `No recorded test loaded ${file}, unless the test run is configured to leave it uninstrumented: ` +
  'the recording keeps no row for a file the run leaves out. ' +
  `The file existed at ${at}, where the recording was made, and the recording lists ${rows} that its 4 tests loaded, but not this one.`;

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-journey-map-cache-'));
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-journey-map-')));
  write('package.json', JSON.stringify({ name: '@t/map', private: true }));
  for (const file of ['main.ts', 'src/a.ts', 'src/m.ts', 'src/y.ts', 'src/z.ts']) write(file);
  git('init', '--quiet');
  git('add', '.');
  commit();
});

afterEach(() => {
  delete process.env['XDG_CACHE_HOME'];
});

describe('a journey map around a file the recording keeps a row for', () => {
  it('maps a recorded module: every test that entered it, and nothing refused', () => {
    recordedAt([]);

    const map = journeyMap(root, 'src/y.ts');
    expect(map?.notRecorded ?? undefined).toBeUndefined();
    expect([map?.suite, map?.entered, map?.kept]).toEqual([4, 1, 1]);
    expect(map?.tests.map((test) => `${test.file} > ${test.name}`)).toEqual(['test/a.test.ts > one']);
  });

  it('answers a test file with the modules its tests ran most, and how many of its tests and of all tests ran each', () => {
    recordedAt([]);

    // The data both wordings of this answer carry: which modules, in which order, with which counts.
    const listed = [...(journeyMap(root, 'test/b.test.ts')?.notRecorded ?? '').matchAll(/^ {2}(\S+) {2}run by (\d+) of its (\d+)(?: tests?)? and (\d+) of all (\d+) recorded tests$/gmu)];
    expect(listed.map((line) => line.slice(1).join(' '))).toEqual(['main.ts 1 1 1 4', 'src/a.ts 1 1 3 4', 'src/m.ts 1 1 3 4']);
  });
});

describe('a journey map around a file the recording keeps no row for', () => {
  it('names a test file as one and lists its modules, those fewer of the whole suite ran first and then by path', () => {
    recordedAt([]);

    expect(journeyMap(root, 'test/a.test.ts')?.notRecorded).toBe(
      'test/a.test.ts is a test file, and journey-map draws its map around the code that tests run. ' +
        'Ask about one of the modules its 2 recorded tests ran most:\n' +
        '  src/z.ts  run by 2 of its 2 tests and 2 of all 4 recorded tests\n' +
        '  src/a.ts  run by 2 of its 2 tests and 3 of all 4 recorded tests\n' +
        '  src/m.ts  run by 2 of its 2 tests and 3 of all 4 recorded tests',
    );
  });

  it('names a test file whose tests ran no function the recording lists, and has no module to offer', () => {
    recordedAt([]);

    expect(journeyMap(root, 'test/idle.test.ts')?.notRecorded).toBe(
      'test/idle.test.ts is a test file, and journey-map draws its map around the code that tests run. ' +
        'None of its 1 recorded test ran a function the recording lists, so there is no module to ask about instead.',
    );
  });

  it('says a path git does not list is not in the checkout', () => {
    recordedAt([]);

    expect(journeyMap(root, 'src/deep/a.ts')?.notRecorded).toBe(
      'src/deep/a.ts is not in the checkout: git lists no such file, and the recording keeps no row for it.',
    );
  });

  it('says a mistyped path is not in the checkout, whatever kind of file its name suggests', () => {
    recordedAt([]);

    expect(journeyMap(root, 'src/a.tss')?.notRecorded).toBe(
      'src/a.tss is not in the checkout: git lists no such file, and the recording keeps no row for it.',
    );
  });

  it('says a file committed since the recording is new since it, and so is one git lists as new and not ignored', () => {
    const at = recordedAt([]);
    write('src/added.ts');
    git('add', '.');
    commit();
    write('src/untracked.ts');

    for (const file of ['src/added.ts', 'src/untracked.ts']) {
      expect(journeyMap(root, file)?.notRecorded).toBe(
        `${file} is new since the recording, which was made at ${at}, so the recording cannot say whether a test loads it.`,
      );
    }
  });

  it('says no recorded test loaded a tracked module that existed at the recording commit beside files it lists', () => {
    const at = recordedAt(['src/old.ts']);

    expect(journeyMap(root, 'src/old.ts')?.notRecorded).toBe(noneLoaded('src/old.ts', at, '4 files in src/'));
  });

  it('names the uninstrumented module as the case the recording cannot rule out', () => {
    // A module a runner config keeps out of instrumentation leaves no trace in the recording, so it reads as the finding does.
    const at = recordedAt(['src/page.ts']);

    const answer = journeyMap(root, 'src/page.ts')?.notRecorded;
    expect(answer).toBe(noneLoaded('src/page.ts', at, '4 files in src/'));
    expect(answer).toContain('unless the test run is configured to leave it uninstrumented');
  });

  it('judges a file by the files the recording lists in its own directory, not in the directories below it', () => {
    // A package-root barrel: every row is under `pkg/src/`, none beside `pkg/index.ts`.
    recordedAt(['pkg/index.ts'], { atRoot: false, under: 'pkg/' });

    expect(journeyMap(root, 'pkg/index.ts')?.notRecorded).toBe(
      `${cannot('pkg/index.ts')}it lists no file in pkg/. A directory with no listed file is either one that no recorded test loaded ` +
        'or one that the test run does not instrument, and the recording does not say which.',
    );
  });

  it('judges a root-level file by the files the recording lists at the root, not by every file it lists', () => {
    const at = recordedAt(['old.ts']);

    expect(journeyMap(root, 'old.ts')?.notRecorded).toBe(noneLoaded('old.ts', at, '1 file at the repository root'));
  });

  it('cannot say for a root-level file when the recording lists no file at the root, however many it lists below it', () => {
    recordedAt(['old.ts'], { atRoot: false });

    expect(journeyMap(root, 'old.ts')?.notRecorded).toBe(
      `${cannot('old.ts')}it lists no file at the repository root. A directory with no listed file is either one that no recorded test loaded ` +
        'or one that the test run does not instrument, and the recording does not say which.',
    );
  });

  it('cannot say for a file the test run does not instrument: a `.json` file or a type declaration', () => {
    recordedAt(['src/data.json', 'src/types.d.ts']);

    for (const file of ['src/data.json', 'src/types.d.ts']) {
      expect(journeyMap(root, file)?.notRecorded).toBe(
        `${cannot(file)}it keeps rows for the source modules a test run instruments, and by default a run leaves out ` +
          'tests, configs, type declarations and files that are not JavaScript or TypeScript.',
      );
    }
  });

  it('cannot say for a file in a directory the recording lists no file under', () => {
    recordedAt(['lib/old.ts']);

    expect(journeyMap(root, 'lib/old.ts')?.notRecorded).toBe(
      `${cannot('lib/old.ts')}it lists no file in lib/. A directory with no listed file is either one that no recorded test loaded ` +
        'or one that the test run does not instrument, and the recording does not say which.',
    );
  });

  it('cannot say when the recording\'s commit does not read', () => {
    committedOld();
    const at = `${testCoverageFile(root)}.cases.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, shared(true));

    expect(journeyMap(root, 'src/old.ts')?.notRecorded).toMatch(
      /^The recording cannot say whether a test loaded src\/old\.ts: the recording's commit did not read \(.+\), so git cannot say whether the file existed when the recording was made\.$/u,
    );
  });

  it('cannot say when the recording names no commit to ask git about', () => {
    committedOld();
    recordedWith(undefined);

    expect(journeyMap(root, 'src/old.ts')?.notRecorded).toBe(
      `${cannot('src/old.ts')}the recording names no commit, so git cannot say whether the file existed when the recording was made.`,
    );
  });

  it('cannot say when git does not have the commit the recording names', () => {
    committedOld();
    recordedWith('0123456789abcdef0123456789abcdef01234567');

    expect(journeyMap(root, 'src/old.ts')?.notRecorded).toMatch(
      /^The recording cannot say whether a test loaded src\/old\.ts: git could not say whether the file existed at 0123456789ab, where the recording was made \(.+\)\.$/u,
    );
  });

  it('says a directory is one, since the map is drawn around a file', () => {
    recordedAt([]);

    for (const asked of ['src', 'src/']) {
      expect(journeyMap(root, asked)?.notRecorded).toBe('src is a directory, and journey-map draws its map around one file: ask about one of the files in it.');
    }
  });

  it('says a file deleted since the recording existed at its commit and is not in the checkout now', () => {
    const at = recordedAt(['src/old.ts']);
    git('rm', '--quiet', 'src/old.ts');
    commit();

    expect(journeyMap(root, 'src/old.ts')?.notRecorded).toBe(`src/old.ts existed at ${at}, where the recording was made, and is not in the checkout now.`);
  });

  it('says git ignores an ignored file that is on disk, rather than that git lists no such file', () => {
    write('.gitignore', 'gen/\n');
    recordedAt([]);
    write('gen/out.ts');

    expect(journeyMap(root, 'gen/out.ts')?.notRecorded).toBe('gen/out.ts is not in the checkout: git ignores it, and the recording keeps no row for it.');
  });

  it('answers from the listing of the checkout its caller carries, rather than asking git again', () => {
    const at = recordedAt(['src/old.ts']);

    const [only] = journeyMaps(root, 'src/old.ts', undefined, { file: false, directory: false, ignored: false });
    expect(only?.map.notRecorded).toBe(`src/old.ts existed at ${at}, where the recording was made, and is not in the checkout now.`);
  });
});

describe('the path a journey map is asked about', () => {
  it('reads a path through `..`, from `./` or from the root of the file system as the path from the checkout', () => {
    recordedAt([]);

    for (const asked of ['src/../src/y.ts', './src/y.ts', join(root, 'src/y.ts')]) {
      const map = journeyMap(root, asked);
      expect([map?.notRecorded ?? undefined, map?.file, map?.entered]).toEqual([undefined, 'src/y.ts', 1]);
    }
  });

  it('refuses a path outside the checkout by saying so, never with what git said', () => {
    recordedAt([]);

    for (const asked of ['../elsewhere.ts', '/elsewhere/a.ts']) {
      expect(journeyMap(root, asked)?.notRecorded).toBe(`${asked} is outside the checkout at ${root}, and the recording holds only paths inside it.`);
    }
  });
});

function committedOld(): void {
  write('src/old.ts');
  git('add', '.');
  commit();
}

/** A recording whose snapshot names `made`, or no commit at all. */
function recordedWith(made: string | undefined): void {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests: [], modules: [], ...(made === undefined ? {} : { commit: made }) }));
  writeFileSync(`${at}.cases.bin`, shared(true));
}
