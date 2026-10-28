import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { describe, expect, it, vi } from 'vitest';
import { EXIT_OPERATOR, OperatorError } from '../exit.js';
import { relationsFor } from './source-graph.js';

// `ci-info` decides CI once, when it loads, from the runner's environment, so a
// variable stubbed inside this process is never asked: the module is cut
// instead. The spawned counterpart, which sets `CI` for a real process, is in
// `index-command.integration.test.ts`.
vi.mock('ci-info', () => ({ isCI: true }));

describe('relationsFor: the file graph a selection reads', () => {
  it("refuses in CI when no source index is published, naming the `variance index` step, as the operator's to fix", async () => {
    const root = await mkdtemp(join(tmpdir(), 'va-source-graph-'));

    const refused = relationsFor(root, ['src']);

    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toMatchObject({
      exitCode: EXIT_OPERATOR,
      message: `no source index is published at ${sourceIndexPath(root)}. In CI the index is a step of the pipeline: ` +
        'restore the cache that holds it, then run `variance index` before this command.',
      cause: { name: 'SourceIndexUnpublished' },
    });
  });
});
