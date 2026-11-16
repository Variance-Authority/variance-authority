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
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('not a variance-authority help store');
  });

  it('refuses a store of another version', async () => {
    const bytes = Buffer.from(stored('2026-10-17T23:59:59.000Z'));
    const version = bytes.indexOf('"version":7');
    bytes.write('"version":6', version);
    await writeFile(workspaceSnapshotPath(index), bytes);
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('written in format version 6, and this reader reads version 7');
  });

  it('refuses a store encoded in memory, which names no generation', async () => {
    await writeFile(workspaceSnapshotPath(index), encodeHelpStore(EMPTY, []).bytes);
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('carries no generation');
  });

  it('reads a store of its own version', async () => {
    await writeFile(workspaceSnapshotPath(index), stored('2026-10-17T23:59:59.000Z'));
    await expect(readWorkspaceSnapshot(root, { index })).resolves.toMatchObject({ packages: [] });
  });

  it('refuses a store whose offset column runs short of the rows it points into', async () => {
    const bytes = Buffer.from(encodeHelpStore(ONE_ENTRY, [], meta('2026-10-17T23:59:59.000Z')).bytes);
    await writeFile(workspaceSnapshotPath(index), bytes);
    await expect(readWorkspaceSnapshot(root, { index })).resolves.toMatchObject({
      packages: [{ name: 'kept', openings: [{ entries: [{ name: 'keptOf' }] }] }],
    });

    // `open.entryOff` reads [0, 1]: the opening owns the one entry. As [0, 0] it
    // would own none, and the value would say `keptOf` is not published.
    bytes.writeUInt32LE(0, columnAt(bytes, 'open.entryOff') + 4);
    await writeFile(workspaceSnapshotPath(index), bytes);
    await expect(readWorkspaceSnapshot(root, { index })).rejects.toThrow('not a variance-authority help store');
  });
});

const meta = (readStartedAt: string) => ({
  root,
  graphRoot: root,
  graphDigest: 'digest',
  generatedAt: '2026-10-18T00:00:00.000Z',
  readStartedAt,
});

const ONE_ENTRY = {
  ...EMPTY,
  packages: [{
    name: 'kept',
    entry: true,
    openings: [{
      subpath: '.',
      source: 'src/index.ts',
      spec: 'kept',
      entries: [{ name: 'keptOf', kind: 'function', at: 'src/index.ts', declared: 'src/index.ts', line: 1, usedBy: [], uses: 0, sites: [], throughDefault: [] }],
      whole: [],
    }],
  }],
};

/** Where the named column's bytes start, read off the segment's header. */
function columnAt(bytes: Buffer, name: string): number {
  const headerLength = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
    sections: { name: string; offset: number }[];
  };
  const section = header.sections.find((held) => held.name === name);
  if (section === undefined) throw new Error(`no column ${name}`);
  return 4 + headerLength + section.offset;
}
