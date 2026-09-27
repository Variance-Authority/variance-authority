import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findEntry, publishLine, readLine, type LineCell, type ShareEntry, type ShareLine } from '@variance-authority/core/share';
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

  describe('two lines one volume folds into one directory', () => {
    const branch = (name: string): ShareLine => ({ kind: 'branch', name });
    const digest = 'e'.repeat(64);

    /**
     * Whether the temporary directory's volume treats two spellings as one name.
     * Asked of the volume, so every test below asserts what is true on it: a
     * case-sensitive volume keeps two lines apart and must go on doing so, and a
     * folding one must refuse or miss rather than answer another line's entries.
     */
    async function volumeFolds(): Promise<boolean> {
      await writeFile(join(root, 'Probe'), '');
      return (await stat(join(root, 'pROBE')).catch(() => null)) !== null;
    }

    /** The text of the line's `report-v1`, or the kind of miss that stood in the way. */
    async function report(cell: LineCell, line: ShareLine): Promise<string> {
      const read = await readLine(cell, line);
      if ('kind' in read) return read.kind;
      const found = findEntry(read.manifest, 'report-v1');
      if ('kind' in found) return found.kind;
      const bytes = await read.entry(found);
      return bytes instanceof Uint8Array ? String.fromCharCode(...bytes) : bytes.kind;
    }

    const publish = (cell: LineCell, name: string): ReturnType<typeof publishLine> =>
      publishLine(cell, branch(name), [entry('report-v1', name, [digest])], { descends, image });

    it.each([
      ['Feature', 'feature'],
      ['feat/X', 'feat/x'],
    ])('keeps %s and %s apart, or refuses the second and reads it as absent', async (first, second) => {
      const share = join(root, 'share');
      const cell = createDirectoryLineCell(share);
      expect(await publish(cell, first)).toMatchObject({ written: ['report-v1'] });
      const published = await publish(cell, second);

      if (!(await volumeFolds())) {
        expect(published).toMatchObject({ written: ['report-v1'] });
        expect([await report(cell, branch(first)), await report(cell, branch(second))]).toEqual([first, second]);
        return;
      }
      const [segment, stored] = [second, first].map((name) => name.split('/').at(-1));
      expect(published).toEqual({
        kind: 'refused',
        detail:
          `branch ${second} names "${segment}" in ${dirname(join(share, 'branch', second))}, and this volume ` +
          `stores "${stored}" there. The two names differ only by case and this volume treats them as one name, ` +
          'so this write would change another line. Put the share on a case-sensitive volume, or give the two ' +
          'branches names that differ by more than case',
      });
      expect([await report(cell, branch(first)), await report(cell, branch(second))]).toEqual([first, 'absent']);

      const held = await readLine(cell, branch(first));
      if ('kind' in held) throw new Error(held.kind);
      expect(await cell.load(branch(second))).toEqual({ kind: 'absent' });
      expect(await cell.blob(branch(second), `entries/${held.manifest.entries[0]!.digest}`)).toEqual({ kind: 'absent' });
      // An image is every line's, whichever spelling asks for it.
      expect(await cell.blob(branch(second), `images/${digest}`)).toEqual(ascii('png'));
    });

    it('never merges lines whose names differ only by case when they are published at once', async () => {
      const cell = createDirectoryLineCell(join(root, 'share'));
      const pairs = Array.from({ length: 8 }, (_, index) => [`Line${String(index)}`, `line${String(index)}`] as const);
      const names = pairs.flat();
      const results = await Promise.all(names.map((name) => publish(cell, name)));
      const reports = await Promise.all(names.map((name) => report(cell, branch(name))));

      if (!(await volumeFolds())) {
        expect(results.every((result) => 'written' in result)).toBe(true);
        expect(reports).toEqual(names);
        return;
      }
      for (const [index] of pairs.entries()) {
        const pair = [results[index * 2]!, results[index * 2 + 1]!];
        const written = pair.map((result) => 'written' in result);
        // One spelling makes the directory and is written; the other finds it and is refused.
        expect(written.filter(Boolean)).toHaveLength(1);
        expect(pair[written.indexOf(false)]).toMatchObject({ kind: 'refused' });
        expect(reports.slice(index * 2, index * 2 + 2)).toEqual(
          names.slice(index * 2, index * 2 + 2).map((name, at) => (written[at] ? name : 'absent')),
        );
      }
      const kept = (await readdir(join(root, 'share', 'branch'))).map((name) => name.toLowerCase()).sort();
      expect(kept).toEqual(pairs.map(([, lower]) => lower).sort());
    });

    it('publishes, reads and republishes a line no other line folds into', async () => {
      const cell = createDirectoryLineCell(join(root, 'share'));
      for (const line of [branch('feature'), branch('release/2.0')]) {
        expect(await publishLine(cell, line, [entry('report-v1', 'r1')], { descends, image })).toMatchObject({ written: ['report-v1'] });
        expect(await report(cell, line)).toBe('r1');
        expect(await publishLine(cell, line, [entry('report-v1', 'r2')], { descends, image })).toMatchObject({ written: ['report-v1'] });
        expect(await report(cell, line)).toBe('r2');
      }
    });
  });
});
