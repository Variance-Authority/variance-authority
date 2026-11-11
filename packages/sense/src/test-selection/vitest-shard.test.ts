import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from 'vitest/config';
import type { SequencerContext } from './vitest-sequencer.js';
import { withTestSelection } from './vitest.js';

describe('a Vitest configuration evaluated for a shard', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
  });

  /** The wrapped configuration, evaluated under `argv`. */
  const configured = async (argv: readonly string[], config: UserConfig = {}): Promise<UserConfig> => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-vitest-shard-'));
    roots.push(root);
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'vitest', 'run', ...argv]);
    return withTestSelection(config, { root, coverageFile: resolve(root, 'coverage.bin') });
  };

  // Vitest 4 refuses `--shard` with fewer files than shards before any
  // sequencer runs, unless the run passes with no tests; a shard left no file
  // is a placement, not a failure, as it is under Jest.
  it('passes with no tests under --shard, in either spelling', async () => {
    expect((await configured(['--shard', '3/3'])).test?.passWithNoTests).toBe(true);
    expect((await configured(['--shard=1/2'])).test?.passWithNoTests).toBe(true);
  });

  it('keeps what the configuration says, and says nothing unsharded', async () => {
    expect((await configured(['--shard', '3/3'], { test: { passWithNoTests: false } })).test?.passWithNoTests).toBe(false);
    expect((await configured([])).test?.passWithNoTests).toBeUndefined();
  });

  // A run `startVitest` shards, with no `--shard` on the command line, is still
  // one shard: it records alone, so it must read what it was handed, or its
  // later wave selects and places from what its earlier wave landed.
  it('reads the record it was handed when Vitest was given a shard the command line does not spell', async () => {
    const asked: [string, boolean][] = [];
    (globalThis as { __beneath?: typeof asked }).__beneath = asked;
    vi.stubEnv('VARIANCE_AUTHORITY_SINCE', '');
    const root = await mkdtemp(resolve(tmpdir(), 'variance-vitest-shard-'));
    roots.push(root);
    const cli = resolve(root, 'node_modules', '@variance-authority', 'cli');
    await mkdir(cli, { recursive: true });
    await writeFile(resolve(cli, 'package.json'), JSON.stringify({ name: '@variance-authority/cli', type: 'module', main: 'index.js' }));
    await writeFile(
      resolve(cli, 'index.js'),
      'export async function selectSuite(request) { globalThis.__beneath.push(["selection", request.beneath ?? false]); return { whole: new Set(), skip: new Set(), notes: [] }; }\n' +
        'export async function suiteTimes(request) { globalThis.__beneath.push(["times", request.beneath ?? false]); return { unread: "a fixture" }; }\n',
    );
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'vitest', 'run']);
    const config = withTestSelection({}, { root });
    const Sequencer = config.test!.sequence!.sequencer as unknown as new (ctx: SequencerContext) => { shard<T>(files: T[]): Promise<T[]> };
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    // Vitest makes its sequencer with the resolved `shard` before it asks for anything.
    await new Sequencer({ config: { shard: { index: 1, count: 2 } }, state: { getPaths: () => [] } }).shard([{ moduleId: resolve(root, 'a.test.ts') }]);

    expect(asked).toEqual([['selection', true], ['times', true]]);
  });
});
