import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from 'vitest/config';
import { withTestSelection } from './vitest.js';

describe('a Vitest configuration evaluated for a shard', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
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
});
