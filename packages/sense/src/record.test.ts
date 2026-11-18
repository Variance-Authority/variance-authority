import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declinedForSize, stillTooLarge } from './record.js';
import { scanRelations } from './scan.js';

/**
 * A scan declines a file for its size, and a later one asks whether the decline
 * still holds before it keeps it. The reading, the decline and its digest are
 * the native batch's, pinned in `acquire_tests.rs` and `record_tests.rs`; what
 * is left here is the TypeScript that reads a decline back.
 */

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((at) => rm(at, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-record-'));
  made.push(root);
  return root;
}

describe('declinedForSize', () => {
  it('tells a stylesheet the scan declined for its size from one of exactly the limit and an empty one', async () => {
    const root = await fixture();
    await writeFile(join(root, 'wide.css'), '.a { color: red; }\n', 'utf8');
    await writeFile(join(root, 'exact.css'), '.a{}/**/', 'utf8');
    await writeFile(join(root, 'empty.css'), '', 'utf8');

    const records = await scanRelations({ root, dirs: ['.'], digests: false, largestFile: 8 });
    const by = new Map(records.map((record) => [record.file, record]));

    expect(by.get('wide.css')?.unknown).toContain('over the 8 this scan opens');
    expect(declinedForSize(by.get('wide.css')!)).toBe(true);
    for (const file of ['exact.css', 'empty.css']) {
      expect(by.get(file)?.unknown).toBeUndefined();
      expect(declinedForSize(by.get(file)!)).toBe(false);
    }
  });
});

describe('stillTooLarge', () => {
  it.skipIf(process.platform === 'win32')('measures the file a link holds, and follows its edits', async () => {
    const root = await fixture();
    await writeFile(join(root, 'wide.css'), '.a { color: red; }\n', 'utf8');
    await symlink(join(root, 'wide.css'), join(root, 'linked.css'));

    expect(await stillTooLarge(join(root, 'linked.css'), 8)).toBe(true);
    await writeFile(join(root, 'wide.css'), '.a{}\n', 'utf8');
    expect(await stillTooLarge(join(root, 'linked.css'), 8)).toBe(false);
    expect(await stillTooLarge(join(root, 'gone.css'), 8)).toBe(false);
  });
});
