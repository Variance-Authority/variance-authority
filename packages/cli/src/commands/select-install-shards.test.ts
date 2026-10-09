import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitRunsFile,
  landRun,
  readCommitRuns,
  testCoverageFile,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { landJourneys } from './land.js';
import { selectOutput } from './select-command.js';
import { checkout, npmLock, snapshot } from './select-install-fixture.js';

/**
 * `variance select` after a landing of shards, over the install they ran on.
 *
 * Each shard is a run of its part of the suite, landed by the real `landRun`
 * into a snapshot of its own as a CI job's seam lands it, and the shards are
 * landed by the real `landJourneys`. A selection after that landing compares
 * the install from the one the shards ran on, as it does after a run landed
 * whole, and from the commit wherever the shards cannot say which one that was.
 */
describe('the install a landing of shards ran on', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-install-shards-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  const SPLIT = [['test/alpha.test.ts', 'test/beta.test.ts'], ['test/gamma.test.ts']];

  /** The part of the three-test snapshot at `commit` that ran `files`. */
  function part(commit: string, files: readonly string[]): TestCoverage {
    const whole = snapshot(commit);
    return {
      ...whole,
      tests: whole.tests.filter((test) => files.includes(test.file)),
      modules: whole.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) => ({ ...block, testFiles: block.testFiles.filter((file) => files.includes(file)) })),
      })),
    };
  }

  /**
   * Commit `left-pad` 1.3.0 and the tests, then run each shard of `SPLIT` with
   * the lockfile at the version `recorded` names for it, uncommitted, and land
   * every shard into this checkout. `between` runs after the shards and before
   * the landing. The lockfile is left at the last shard's version.
   */
  async function landedOver(
    recorded: readonly string[],
    between: (shards: readonly string[]) => void = () => {},
  ): Promise<{ root: string; head: string }> {
    const { root, head } = checkout({ 'package-lock.json': npmLock('1.3.0') });
    const shards: string[] = [];
    for (const [index, files] of SPLIT.entries()) {
      writeFileSync(join(root, 'package-lock.json'), npmLock(recorded[index]!));
      const at = join(root, '.shards', `shard-${index}`, 'coverage.bin');
      mkdirSync(join(at, '..'), { recursive: true });
      await landRun(at, part(head, files), root);
      shards.push(at);
    }
    between(shards);
    await landJourneys(root, shards);
    process.chdir(root);
    await indexOutput({ cwd: root });
    return { root, head };
  }

  it('skips every test when the shards ran on the install on disk, bump uncommitted', async () => {
    const { root } = await landedOver(['1.4.0', '1.4.0']);

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/beta.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).not.toContain('resolves');
  });

  it('compares a later bump from the install the shards ran on', async () => {
    const { root, head } = await landedOver(['1.4.0', '1.4.0']);

    writeFileSync(join(root, 'package-lock.json'), npmLock('1.5.0'));
    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(
      `package-lock.json resolves 1 package differently than the install recorded at ${head.slice(0, 12)} (left-pad)`,
    );
  });

  it('keeps no install, and compares from the commit, when the shards ran on two', async () => {
    const { root, head } = await landedOver(['1.5.0', '1.4.0']);
    expect(await readCommitRuns(testCoverageFile(root))).not.toHaveProperty('installed');

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(`package-lock.json resolves 1 package differently than at ${head.slice(0, 12)} (left-pad)`);
  });

  it('keeps no install, and compares from the commit, when a shard came without its runs record', async () => {
    const { root, head } = await landedOver(['1.4.0', '1.4.0'], (shards) => rmSync(commitRunsFile(shards[1]!)));
    expect(await readCommitRuns(testCoverageFile(root))).not.toHaveProperty('installed');

    const said = await selectOutput({ cwd: root, format: 'plain' });

    expect(said.out).toBe('test/alpha.test.ts\ntest/gamma.test.ts\n');
    expect(said.err).toContain(`package-lock.json resolves 1 package differently than at ${head.slice(0, 12)} (left-pad)`);
  });
});
