import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { journeysAround, journeysPath, prepareJourneys } from './journeys.js';
import { updateSourceIndex } from './published.js';
import { runnerAliases, runnerConfigs, runnerDigest } from './runner-aliases.js';
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
  it('say none are prepared before anything is recorded, where the recording was looked for', async () => {
    await updateSourceIndex(root);
    const [only] = await prepareJourneys(root);

    expect(only).toEqual({ out: journeysPath(sourceIndexPath(root)), unprepared: `nothing is recorded at ${testCoverageFile(root)}.cases.bin` });
    expect(journeysAround(root, [{ file: 'src/api.ts' }])).toEqual([
      { answer: { notPrepared: 'there is no recording to walk', cases: 0, files: [] } },
    ]);
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
    const [again] = await prepareJourneys(root);
    expect(again && 'prepared' in again && again.prepared.kept).toBe(true);

    const [{ answer }] = journeysAround(root, [{ file: 'src/api.ts' }, { file: 'src/api.ts', line: 5 }]) as [{ answer: import('./journeys.js').JourneysAnswer }];
    expect(answer.notPrepared ?? undefined).toBeUndefined();
    expect(answer.cases).toBe(1);
    const [file, line] = answer.files;
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

describe("the runner's alias table", () => {
  const fixture = fileURLToPath(new URL('../test/fixtures/runner-aliases', import.meta.url));

  it('lists the tracked configs, reads their aliases with the Vite the checkout resolves, and stamps every file it read', async () => {
    const configs = await runnerConfigs(fixture);
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
  });
});
