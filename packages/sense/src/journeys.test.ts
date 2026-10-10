import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forksBetween, journeysAmong, journeysAround, journeyMap, journeysPath, pathsThrough, prepareJourneys, testCompositions } from './journeys.js';
import { updateSourceIndex } from './published.js';
import { sourceIndexPath } from './source-index.js';
import { withCaseSections } from './test-selection/case-record.js';
import { CrossingSets } from './test-selection/crossing-sets.js';
import { encodeSetExecutionIndex } from './test-selection/execution-set-format.js';
import { encodeTestCoverage } from './test-selection/format.js';
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

/** The record a run leaves, carrying `index` as its cases and naming no commit. */
function record(index: Uint8Array): void {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, withCaseSections(encodeTestCoverage({ version: 3, instrumentation: 'fixture', tests: [], modules: [] }), { index }));
}

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

    expect(only).toEqual({ out: journeysPath(sourceIndexPath(root)), unprepared: `nothing is recorded at ${testCoverageFile(root)}` });
    expect(journeysAround(root, [{ file: 'src/api.ts' }])).toEqual([]);
  });

  it('walk the recorded case once, keep the file while nothing it was made from changes, and answer a file and a line', async () => {
    await updateSourceIndex(root);
    record(recording());

    const [first] = await prepareJourneys(root);
    expect(first && 'prepared' in first ? first.prepared : first).toMatchObject({
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
    record(recording(1));
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
    record(two());
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
    record(branched());

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

    // Two of three cases entered every region `finds` entered, so all of it is structure and it has no footprint.
    const [composed] = testCompositions(root, join(root, 'test/api.test.ts'), 'finds');
    const { composition } = composed ?? {};
    expect([composition?.test?.name, composition?.test?.blocks, composition?.structure, composition?.alike]).toEqual(['finds', 0, 3, 0]);
    expect(composition?.own).toEqual([]);
    expect(testCompositions(root, 'test/api.test.ts')[0]?.composition.notRecorded).toBe(
      'test/api.test.ts declares 3 recorded tests; name one of them:\n  finds\n  finds again\n  misses',
    );

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

  it('compose a test that no other case shares into its own layer alone', () => {
    record(recording(3));

    const [composed] = testCompositions(root, 'test/api.test.ts', 'gets');
    const { composition } = composed ?? {};
    expect([composition?.suite, composition?.test?.blocks, composition?.structure, composition?.explained]).toEqual([4, 2, 0, 0]);
    expect([composition?.pieces, composition?.wholes, composition?.reached]).toEqual([[], [], []]);
    expect(composition?.own.map((block) => `${block.file}:${block.line}`)).toEqual(['src/api.ts:1', 'src/api.ts:4']);
    expect(testCompositions(root, '../elsewhere.test.ts')[0]?.composition.notRecorded).toMatch(/elsewhere/u);
  });
});
