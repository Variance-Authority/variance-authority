import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findEntry, publishLine, readLine, type ShareEntry } from '@variance-authority/core/share';
import { createDirectoryLineCell } from './share.js';

const MAIN = { kind: 'mainline', name: 'main' } as const;
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry = (name: string, text: string, images?: string[]): ShareEntry => ({
  name,
  commit: 'cccc',
  bytes: ascii(text),
  ...(images !== undefined ? { images } : {}),
});
const descends = async (): Promise<boolean> => false;
const image = async (): Promise<Uint8Array> => ascii('png');

describe('createDirectoryLineCell', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-line-'));
  });

  afterEach(async () => {
    await chmod(root, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('holds a line as a manifest, its entries, and images shared by every line', async () => {
    const cell = createDirectoryLineCell(root);
    const digest = 'd'.repeat(64);
    await publishLine(cell, MAIN, [entry('report-v1', 'r', [digest])], { descends, image });
    expect((await readdir(root)).sort()).toEqual(['images', 'mainline']);
    expect(await readdir(join(root, 'mainline', 'main'))).toEqual(expect.arrayContaining(['entries', 'manifest.json']));

    const read = await readLine(cell, MAIN);
    if ('kind' in read) throw new Error(read.kind);
    const found = findEntry(read.manifest, 'report-v1');
    if ('kind' in found) throw new Error(found.kind);
    expect(await read.entry(found)).toEqual(ascii('r'));
    expect(await read.image(digest)).toEqual(ascii('png'));
  });

  it('keeps every suite when jobs publish at once', async () => {
    const cell = createDirectoryLineCell(root);
    const suites = ['a', 'b', 'c', 'd', 'e', 'f'];
    await Promise.all(suites.map((suite) => publishLine(cell, MAIN, [entry(`suite-v1/${suite}`, suite)], { descends, image })));
    const read = await readLine(cell, MAIN);
    if ('kind' in read) throw new Error(read.kind);
    expect(read.manifest.entries.map((held) => held.name)).toEqual(suites.map((suite) => `suite-v1/${suite}`));
  });

  it('refuses a write against a version that moved', async () => {
    const cell = createDirectoryLineCell(root);
    await publishLine(cell, MAIN, [entry('report-v1', 'r')], { descends, image });
    expect(await cell.store(MAIN, { manifest: ascii('{}'), blobs: new Map(), expected: 'stale' })).toBe('conflict');
    expect(await cell.store(MAIN, { manifest: ascii('{}'), blobs: new Map() })).toBe('conflict');
  });

  it('takes over a lock a dead writer left', async () => {
    const cell = createDirectoryLineCell(root);
    await mkdir(join(root, 'mainline', 'main', '.lock'), { recursive: true });
    const old = new Date(Date.now() - 120_000);
    const { utimes } = await import('node:fs/promises');
    await utimes(join(root, 'mainline', 'main', '.lock'), old, old);
    expect(await publishLine(cell, MAIN, [entry('report-v1', 'r')], { descends, image })).toMatchObject({ written: ['report-v1'] });
  });

  it('refuses an entry or an image path that climbs out of the root, and writes nothing outside it', async () => {
    const inside = join(root, 'share');
    const cell = createDirectoryLineCell(inside);
    const climbing = [
      ['entries/../../../../outside', 'entry path entries/../../../../outside on mainline main'],
      ['images/../../outside-image', 'image path images/../../outside-image'],
    ] as const;

    for (const [path, named] of climbing) {
      const stored = await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map([[path, ascii('x')]]) });
      expect(stored).toEqual({ kind: 'refused', detail: `${named} resolves outside the share root ${inside}` });
    }
    expect((await readdir(root)).sort()).toEqual(['share']);
    // Refused before the manifest, so the line was never written either.
    expect(await cell.load(MAIN)).toEqual({ kind: 'absent' });

    await writeFile(join(root, 'outside'), 'not the share\'s');
    expect(await cell.blob(MAIN, 'entries/../../../../outside')).toMatchObject({ kind: 'refused' });
    expect(await readFile(join(root, 'outside'), 'utf8')).toBe('not the share\'s');
  });

  it('leaves no staged file behind when a write finishes', async () => {
    const cell = createDirectoryLineCell(root);
    const digest = 'd'.repeat(64);
    await publishLine(cell, MAIN, [entry('report-v1', 'r', [digest])], { descends, image });
    await publishLine(cell, MAIN, [entry('report-v1', 'r2', [digest])], { descends, image });

    const files = (await readdir(root, { recursive: true })).map(String);
    expect(files.filter((file) => file.endsWith('.part'))).toEqual([]);
    expect(files).toContain(join('mainline', 'main', 'manifest.json'));
  });

  it('tells nothing published from a directory it may not read', async () => {
    const cell = createDirectoryLineCell(root);
    expect(await readLine(cell, MAIN)).toEqual({ kind: 'absent' });
    await publishLine(cell, MAIN, [entry('report-v1', 'r')], { descends, image });
    await chmod(root, 0o000);
    expect(await readLine(cell, MAIN)).toMatchObject({ kind: 'refused' });
  });
});
