import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceSnapshot, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, workspaceSnapshotPath } from './snapshot.js';

/**
 * A snapshot holds `Help` as JSON, so a change to the shape of `Help` changes
 * the version, and a value written in the shape before it is refused rather
 * than read: a v9 export has no `bound`, the name it binds in its own file, and
 * a reader handed one would key every default export by the slot `default`.
 * So does a time the reader needs: a v12 value says when it was published, not
 * when its read began, and a look at the checkout cannot be made against it.
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
  ...(version >= 13 ? { readStartedAt: '2026-10-17T23:59:59.000Z' } : {}),
  help: { packages: [], deep: [], unfollowed: [], byPath: [], exported: [], unreadable: [] },
});

describe('the workspace snapshot version', () => {
  it('is 13, the shape that says when its read began', () => {
    expect(SNAPSHOT_VERSION).toBe(13);
  });

  it('refuses a v12 value, which says only when it was published', async () => {
    const index = join(root, 'source-index.bin');
    await writeFile(workspaceSnapshotPath(index), JSON.stringify(written(12)));
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow(`is not a ${SNAPSHOT_FORMAT} v13 value`);
  });

  it('refuses a value of its own version that does not say when its read began', async () => {
    const index = join(root, 'source-index.bin');
    await writeFile(workspaceSnapshotPath(index), JSON.stringify({ ...written(13), readStartedAt: undefined }));
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow(`is not a ${SNAPSHOT_FORMAT} v13 value`);
  });

  it('reads a value of its own version', async () => {
    const index = join(root, 'source-index.bin');
    await writeFile(workspaceSnapshotPath(index), JSON.stringify(written(13)));
    await expect(readWorkspaceSnapshot(root, { index })).resolves.toMatchObject({ packages: [] });
  });
});
