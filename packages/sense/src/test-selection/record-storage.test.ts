import { readSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { recordStorageAt } from './case-record.js';
import { column, sections } from './format-layout.js';

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, readSync: vi.fn(actual.readSync) };
});

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function at(bytes: Uint8Array): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'record-storage-'));
  const path = join(root, 'record.bin');
  await writeFile(path, bytes);
  return path;
}

it('reads only the directory and reports physical elements for opaque and packed sections', async () => {
  const record = sections({
    opaque: { plain: Buffer.alloc(32_768, 255), rows: 32_768, width: 1 },
    words: column(new Uint32Array(32_768).fill(7)),
  }, 123);
  const path = await at(record);
  const payload = 4 + record.readUInt32LE(0);
  vi.mocked(readSync).mockClear();

  const reading = recordStorageAt(path);

  expect(reading).toMatchObject({ format: 123, bytes: record.length });
  expect(reading.sections[0]).toEqual({ name: 'opaque', bytes: 32_768, rows: 32_768, width: 1, packed: false });
  expect(reading.sections[1]).toMatchObject({ name: 'words', rows: 32_768, width: 4, packed: true });
  expect(reading.sections[1]!.bytes).toBeLessThan(32_768 * 4);
  expect(reading.sections.reduce((sum, section) => sum + section.bytes, reading.overheadBytes)).toBe(record.length);
  expect(vi.mocked(readSync).mock.calls.every((call) => Number(call.at(4)) + Number(call.at(3)) <= payload)).toBe(true);
});

it('refuses a directory that does not name its format', async () => {
  const record = sections({ opaque: column(new Uint8Array([1])) });
  const end = 4 + record.readUInt32LE(0);
  const header = JSON.parse(record.subarray(4, end).toString().replace(/\0+$/u, ''));
  delete header.version;
  record.fill(0, 4, end);
  Buffer.from(JSON.stringify(header)).copy(record, 4);
  const path = await at(record);
  expect(() => recordStorageAt(path)).toThrow();
});
