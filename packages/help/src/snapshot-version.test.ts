import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceSnapshot, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, workspaceSnapshotPath } from './snapshot.js';

/**
 * A snapshot holds `Help` as JSON, so a change to the shape of `Help` changes
 * the version, and a value written in the shape before it is refused rather
 * than read: a v7 entry has no `throughDefault` and a v7 opening no `whole`,
 * and a reader handed one would fail on the first name it answered.
 */

let root: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'help-snapshot-version-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const written = (version: number) => ({
  format: SNAPSHOT_FORMAT,
  version,
  root,
  graphRoot: root,
  graphDigest: 'digest',
  generatedAt: '2026-10-18T00:00:00.000Z',
  help: { packages: [], deep: [], unfollowed: [], byPath: [], exported: [], unreadable: [] },
});

describe('the workspace snapshot version', () => {
  it('is 8, the shape that keeps reads through `default` and a module passed on whole apart', () => {
    expect(SNAPSHOT_VERSION).toBe(8);
  });

  it('refuses a v7 value, written before that shape', async () => {
    const index = join(root, 'source-index.bin');
    await writeFile(workspaceSnapshotPath(index), JSON.stringify(written(7)));
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow(`is not a ${SNAPSHOT_FORMAT} v8 value`);
  });

  it('reads a value of its own version', async () => {
    const index = join(root, 'source-index.bin');
    await writeFile(workspaceSnapshotPath(index), JSON.stringify(written(8)));
    await expect(readWorkspaceSnapshot(root, { index })).resolves.toMatchObject({ packages: [] });
  });
});
