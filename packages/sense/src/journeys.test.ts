import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forksBetween, journeysAmong, journeysAround, journeyMap, journeysPath, pathsThrough, prepareJourneys } from './journeys.js';
import { updateSourceIndex } from './published.js';
import { keptRunnerAliases, runnerAliases, runnerConfigs, runnerDigest, unlistedRunnerAliases } from './runner-aliases.js';
import { sourceIndexPath } from './source-index.js';
import { CrossingSets } from './test-selection/crossing-sets.js';
import { encodeSetExecutionIndex } from './test-selection/execution-set-format.js';
import { testCoverageFile } from './test-selection/record-location.js';

/**
 * Journeys prepared beside a published index from a recording, and asked about:
 * one case calls `get`, which calls `put` in the same file, and both are
 * recorded as run by it.
 */

const region = (kind: string, name: string, startLine: number, endLine: number) =>
  ({ kind, name, path: name, startLine, endLine, source: true });

/** One case that ran both functions, and `idle` more that ran neither. */
function recording(idle = 0): Buffer {
  const tests = [{ id: 'api > gets', file: 'test/api.test.ts', name: 'gets' }];
  for (let at = 0; at < idle; at += 1) tests.push({ id: `api > idle ${at}`, file: 'test/api.test.ts', name: `idle ${at}` });
  const sets = new CrossingSets(tests.length);
  return encodeSetExecutionIndex({
    tests,
    modules: [
      {
        file: 'src/api.ts',
        blocks: [region('module', '', 1, 6), region('function', 'get', 1, 3), region('function', 'put', 4, 6)],
        called: Uint32Array.of(sets.intern([]), sets.intern([0]), sets.intern([0])),
        loaded: Uint8Array.of(1, 0, 0),
      },
    ],
    sets: sets.pool(),
  });
}

let root: string;

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-journeys-cache-'));
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-journeys-')));
  write('package.json', JSON.stringify({ name: '@t/api', private: true }));
  write('src/api.ts', 'export function get(id: string) {\n  return put(id);\n}\nexport function put(id: string) {\n  return id;\n}\n');
  write('test/api.test.ts', "import { get } from '../src/api.js';\nit('gets', () => get('x'));\n");
  write('vitest.config.ts', 'export default {};\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
});

afterEach(() => {
  delete process.env['XDG_CACHE_HOME'];
});

describe('the journeys prepared beside the index', () => {
  it('say none are prepared before anything is recorded, where the recording was looked for, and answer with no suite', async () => {
    await updateSourceIndex(root);
    const [only] = await prepareJourneys(root);

    expect(only).toEqual({ out: journeysPath(sourceIndexPath(root)), unprepared: `nothing is recorded at ${testCoverageFile(root)}.cases.bin` });
    expect(journeysAround(root, [{ file: 'src/api.ts' }])).toEqual([]);
  });

  it('walk the recorded case once, keep the file while nothing it was made from changes, and answer a file and a line', async () => {
    await updateSourceIndex(root);
    const at = `${testCoverageFile(root)}.cases.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, recording());

    const [first] = await prepareJourneys(root);
    expect(first && 'prepared' in first ? { ...first.prepared, runnerUnread: [] } : first).toMatchObject({
      kept: false,
      cases: 1,
      functionsEntered: 2,
      placed: 2,
    });
    // The recording names no commit, so the walk parsed the tree as it is, and says so.
    const tree = first && 'prepared' in first ? first.prepared.tree : undefined;
    expect(tree).toMatch(/commit/u);
    const [again] = await prepareJourneys(root);
    expect(again && 'prepared' in again && again.prepared.kept).toBe(true);
    expect(again && 'prepared' in again && again.prepared.tree).toBe(tree);

    const [{ answer }] = journeysAround(root, [{ file: 'src/api.ts' }, { file: 'src/api.ts', line: 5 }]) as [{ answer: import('./journeys.js').JourneysAnswer }];
    expect(answer.notPrepared ?? undefined).toBeUndefined();
    expect(answer.cases).toBe(1);
    expect(answer.tree).toBe(tree);
    const [file, line] = answer.files;
    expect(file?.cases).toBe(1);
    expect(file?.flows).toMatchObject({ package: '@t/api', through: 1 });
    expect(line?.unplaced).toMatch(/commit/u);
    expect(file?.blocks.map((block) => block.name)).toEqual(['get', 'put']);
    expect(file?.callers).toEqual([expect.objectContaining({ at: 'get', cases: 1 })]);
    expect(line?.focus?.name).toBe('put');
    expect(line?.focus?.callers).toEqual([expect.objectContaining({ name: 'get', file: 'src/api.ts', line: 1, cases: 1 })]);

    // A recording made again after the walk is not answered from the walk.
    writeFileSync(at, recording(1));
    const [{ answer: stale }] = journeysAround(root, [{ file: 'src/api.ts' }]) as [{ answer: import('./journeys.js').JourneysAnswer }];
    expect(stale.notPrepared).toBe('the recording changed after they were prepared');
  });
});

describe('the calls some of the cases placed', () => {
  /** `gets` runs `get` and `put`; `peeks` runs `get` alone. */
  function two(): Buffer {
    const tests = [
      { id: 'api > gets', file: 'test/api.test.ts', name: 'gets' },
      { id: 'api > peeks', file: 'test/api.test.ts', name: 'peeks' },
    ];
    const sets = new CrossingSets(tests.length);
    return encodeSetExecutionIndex({
      tests,
      modules: [
        {
          file: 'src/api.ts',
          blocks: [region('module', '', 1, 6), region('function', 'get', 1, 3), region('function', 'put', 4, 6)],
          called: Uint32Array.of(sets.intern([]), sets.intern([0, 1]), sets.intern([0])),
          loaded: Uint8Array.of(1, 0, 0),
        },
      ],
      sets: sets.pool(),
    });
  }

  it('are counted among the asked cases alone, and a case the recording does not hold is named', async () => {
    write('test/api.test.ts', "import { get } from '../src/api.js';\nit('gets', () => get('x'));\nit('peeks', () => get('y'));\n");
    await updateSourceIndex(root);
    const at = `${testCoverageFile(root)}.cases.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, two());
    await prepareJourneys(root);

    const call = (among: import('./journeys.js').JourneysAmong | undefined) =>
      among?.calls.map((placed) => `${placed.from?.name ?? 'test'}>${placed.to.name} ${placed.cases}/${placed.all}`);
    expect(call(journeysAmong(root, [0, 1]))).toEqual(['test>get 2/2', 'get>put 1/1']);
    const peeks = journeysAmong(root, [1, 9]);
    expect(call(peeks)).toEqual(['test>get 1/2']);
    expect(peeks?.outside).toEqual([9]);
    expect(journeysAmong(root, [0], 'no such suite')).toBeUndefined();
  });
});

describe('journeys read as masks', () => {
  /** `get` runs for all three cases; two take its branch and reach `put`. */
  function branched(): Buffer {
    const tests = ['finds', 'misses', 'finds again'].map((name) => ({ id: `api > ${name}`, file: 'test/api.test.ts', name }));
    const sets = new CrossingSets(tests.length);
    return encodeSetExecutionIndex({
      tests,
      modules: [
        {
          file: 'src/api.ts',
          blocks: [region('module', '', 1, 6), region('function', 'get', 1, 3), region('branch', '', 2, 2), region('function', 'put', 4, 6)],
          called: Uint32Array.of(sets.intern([]), sets.intern([0, 1, 2]), sets.intern([0, 2]), sets.intern([0, 2])),
          loaded: Uint8Array.of(1, 0, 0, 0),
        },
      ],
      sets: sets.pool(),
    });
  }

  it('answers the paths through a function and the forks between two off the recording alone', () => {
    const at = `${testCoverageFile(root)}.cases.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, branched());

    const paths = pathsThrough(root, { file: 'src/api.ts', line: 2 });
    expect(paths?.function?.name).toBe('get');
    expect(paths?.paths.map((path) => [path.cases, path.entered.map((block) => block.line), path.passage, path.smallest.name])).toEqual([
      [2, [2], true, 'finds'],
      [1, [], false, 'misses'],
    ]);
    expect(pathsThrough(root, { file: 'src/api.ts', line: 9 })?.notRecorded).toBe('no function the recording holds spans src/api.ts:9');

    const forks = forksBetween(root, { file: 'src/api.ts', line: 1 }, { file: 'src/api.ts', line: 5 });
    expect([forks?.reachedA, forks?.reachedB, forks?.both, forks?.connection?.alike, forks?.thin]).toEqual([3, 2, 2, 1, true]);
    // The miss shares a third of the connecting journey: it arrives by another road, not nearly.
    expect(forks?.sides?.map((side) => [side.end, side.only, side.near, side.best, side.forks ?? null])).toEqual([['a', 1, 0, 1 / 3, null]]);
    expect(pathsThrough(root, { file: 'src/api.ts', line: 2 }, 'no such suite')).toBeUndefined();

    const map = journeyMap(root, 'src/api.ts');
    expect([map?.suite, map?.entered, map?.kept, map?.structure, map?.spine, map?.branches]).toEqual([3, 3, 3, 0, [], []]);
    expect(map?.tests.map((test) => [test.name, test.blocks, test.alike])).toEqual([
      ['misses', 1, 0],
      ['finds', 3, 1],
      ['finds again', 3, 1],
    ]);
    expect(map?.functions.map((held) => [held.function.name, held.cases, held.paths.length])).toEqual([
      ['get', 3, 2],
      ['put', 2, 1],
    ]);
    expect(journeyMap(root, 'src/api.ts', ['AGAIN'])?.tests.map((test) => test.name)).toEqual(['finds again']);
  });

  it('says why a file has no map: a test file names the modules its tests ran, and no row is a finding only where the recording lists files', () => {
    const at = `${testCoverageFile(root)}.cases.bin`;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, branched());

    expect(journeyMap(root, 'test/api.test.ts')?.notRecorded).toBe(
      'test/api.test.ts is a test file, and a journey map is drawn around code that tests run. ' +
        'Ask about one of the modules its 3 recorded tests ran most:\n' +
        '  src/api.ts  run by 3 of its 3 and 3 of all 3 recorded tests',
    );
    expect(journeyMap(root, 'src/none.ts')?.notRecorded).toBe(
      'No recorded test ran src/none.ts. This is a finding about the tests, not a gap in the recording: ' +
        'the recording lists 1 file under src/ that its 3 tests loaded, and this file is not one of them.',
    );
    expect(journeyMap(root, 'lib/none.ts')?.notRecorded).toBe(
      'The recording lists no file under lib/, so it cannot say whether a test ran lib/none.ts. ' +
        'A directory with no listed file is either one that no recorded test loaded or one that the test run does not instrument, ' +
        'and the recording does not say which.',
    );
  });
});

describe("the runner's alias table", () => {
  const fixture = fileURLToPath(new URL('../test/fixtures/runner-aliases', import.meta.url));

  it('lists the tracked configs, reads their aliases with the Vite the checkout resolves, and stamps every file it read', async () => {
    const configs = runnerConfigs(fixture);
    expect(configs).toEqual(['vitest.config.ts']);

    const table = await runnerAliases(fixture, configs ?? []);
    expect(table.unread).toEqual([]);
    expect(table.configs).toEqual([
      { directory: '', aliases: [{ find: '@api', replacement: './src/api.ts' }, { source: '^~\\/(.*)$', flags: '', replacement: './src/$1' }] },
    ]);
    expect(table.files).toEqual(['vitest.config.ts', 'where.ts']);
    expect(table.digest).toBe(runnerDigest(fixture, table.files));
    // A file the table was read from going missing moves the stamp.
    expect(runnerDigest(fixture, [...table.files, 'gone.ts'])).not.toBe(table.digest);
  });

  it('names a config it has no Vite to load with, and reads no alias from it', async () => {
    const table = await runnerAliases(root, ['vitest.config.ts']);

    expect(table.configs).toEqual([]);
    expect(table.unread).toEqual([expect.stringMatching(/^vitest\.config\.ts: no Vite to load it with \(/u)]);
    expect(table.unloaded).toEqual(['vitest.config.ts']);
    // What it needed is outside the stamp, so the table is not kept: it is read again.
    const kept = join(root, 'runner-aliases.json');
    writeFileSync(kept, JSON.stringify({ ...table, unread: ['held'] }));
    expect(await keptRunnerAliases(root, ['vitest.config.ts'], kept)).toEqual(table);
  });

  it('keeps the table beside the index, and reads it again when a file it was read from changes', async () => {
    const kept = join(root, 'runner-aliases.json');
    const read = await keptRunnerAliases(fixture, ['vitest.config.ts'], kept);
    expect(JSON.parse(readFileSync(kept, 'utf8'))).toEqual(read);

    // A table kept under a stamp nothing on disk matches is not believed.
    writeFileSync(kept, JSON.stringify({ ...read, digest: 'stale', configs: [] }));
    expect(await keptRunnerAliases(fixture, ['vitest.config.ts'], kept)).toEqual(read);
    // One kept under the right stamp is used as kept, and Vite is not asked.
    const held = { ...read, unread: ['held'] };
    writeFileSync(kept, JSON.stringify(held));
    expect(await keptRunnerAliases(fixture, ['vitest.config.ts'], kept)).toEqual(held);
  });

  it('names every alias it cannot carry, and the table it could not list', async () => {
    const dropped = fileURLToPath(new URL('../test/fixtures/runner-aliases-dropped', import.meta.url));
    const table = await runnerAliases(dropped, ['vitest.config.ts']);

    expect(table.configs).toEqual([{ directory: '', aliases: [{ find: '@test', replacement: './src/test.ts' }, { find: '@kept', replacement: './src/kept.ts' }] }]);
    expect(table.unread).toEqual([
      'vitest.config.ts: resolve.alias `@custom` has a customResolver, which is not read',
      'vitest.config.ts: resolve.alias `@made` is replaced by a function, which is not read',
    ]);
    expect(unlistedRunnerAliases(root, 'git could not list the checkout').unread).toEqual([
      'runner configs were not listed: git could not list the checkout',
    ]);
  });
});
