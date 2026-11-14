import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeHelpStore } from '@variance-authority/sense';
import { readWorkspaceSnapshot, workspaceSnapshotPath } from './snapshot.js';

/**
 * The published value is one binary store whose head names its format and
 * version, so a store written in another shape is refused rather than read:
 * a JSON value from before it, or a store of another version. So is a store
 * that does not say when its read began, since a look at the checkout cannot
 * be made against it.
 */

let root: string;
let index: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'help-snapshot-version-')));
  index = join(root, 'source-index.bin');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const EMPTY = { packages: [], deep: [], byPath: [], unfollowed: [], unreadable: [] };

const stored = (readStartedAt: string): Uint8Array => encodeHelpStore(EMPTY, [], {
  root,
  graphRoot: root,
  graphDigest: 'digest',
  generatedAt: '2026-10-18T00:00:00.000Z',
  readStartedAt,
}).bytes;

describe('the workspace store version', () => {
  it('refuses the JSON value written before it', async () => {
    await writeFile(workspaceSnapshotPath(index), JSON.stringify({ format: 'variance-help-workspace', version: 13 }));
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('not a help store v6');
  });

  it('refuses a store of another version', async () => {
    const bytes = Buffer.from(stored('2026-10-17T23:59:59.000Z'));
    bytes.writeUInt32LE(5, 4);
    await writeFile(workspaceSnapshotPath(index), bytes);
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('not a help store v6');
  });

  it('refuses a store encoded in memory, which names no generation', async () => {
    await writeFile(workspaceSnapshotPath(index), encodeHelpStore(EMPTY, []).bytes);
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('carries no generation');
  });

  it('reads a store of its own version', async () => {
    await writeFile(workspaceSnapshotPath(index), stored('2026-10-17T23:59:59.000Z'));
    await expect(readWorkspaceSnapshot(root, { index })).resolves.toMatchObject({ packages: [] });
  });
});
