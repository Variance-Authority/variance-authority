import { variancePrecondition } from '@variance-authority/sense/precondition';
import { describe, expect, it } from 'vitest';
import { decodeManifest, encodeManifest, entryDigest, type LineCell, type LineManifest, type ShareEntry } from './line.js';
import { findEntry, memoryLineCell, publishLine, readLine, type Descends } from './publish.js';

const MAIN = { kind: 'mainline', name: 'main' } as const;
const BRANCH = { kind: 'branch', name: 'feat/x' } as const;
const IMAGE = 'e'.repeat(64);
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry = (name: string, commit: string, text = `${name}@${commit}`, images?: string[]): ShareEntry => ({
  name,
  commit,
  bytes: ascii(text),
  ...(images !== undefined ? { images } : {}),
});

/** A history in which each commit's parent is the one before it: `a` ← `b` ← `c`. */
const linear: Descends = async (descendant, ancestor) => {
  const order = ['aaaa', 'bbbb', 'cccc'];
  const d = order.indexOf(descendant);
  const a = order.indexOf(ancestor);
  return d === -1 || a === -1 ? undefined : d > a;
};

const images = async (): Promise<Uint8Array> => ascii('png');

async function held(cell: LineCell, line = MAIN): Promise<LineManifest> {
  const read = await readLine(cell, line);
  if ('kind' in read) throw new Error(read.kind);
  return read.manifest;
}

describe('publishLine', () => {
  it('writes a line that did not exist, and reads it back', async () => {
    const cell = memoryLineCell();
    const result = await publishLine(cell, MAIN, [entry('report-v1', 'bbbb')], { descends: linear, image: images });
    expect(result).toMatchObject({ written: ['report-v1'], kept: [], attempts: 1 });
    const read = await readLine(cell, MAIN);
    if ('kind' in read) throw new Error(read.kind);
    const found = findEntry(read.manifest, 'report-v1');
    if ('kind' in found) throw new Error(found.kind);
    expect(await read.entry(found)).toEqual(ascii('report-v1@bbbb'));
  });

  it('keeps a held entry whose commit descends from the run: an older run finishing last', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', 'cccc')], { descends: linear, image: images });
    const result = await publishLine(cell, MAIN, [entry('report-v1', 'bbbb')], { descends: linear, image: images });
    expect(result).toMatchObject({ written: [], kept: [{ name: 'report-v1', commit: 'cccc', because: 'newer-commit' }] });
    expect((await held(cell)).entries[0]?.commit).toBe('cccc');
  });

  it('replaces a held entry the run descends from', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', 'aaaa')], { descends: linear, image: images });
    await publishLine(cell, MAIN, [entry('report-v1', 'bbbb')], { descends: linear, image: images });
    expect((await held(cell)).entries[0]?.commit).toBe('bbbb');
  });

  it('replaces after a force-push, when neither commit descends from the other', async () => {
    const cell = memoryLineCell();
    const unrelated: Descends = async () => false;
    await publishLine(cell, MAIN, [entry('report-v1', 'cccc')], { descends: unrelated, image: images });
    await publishLine(cell, MAIN, [entry('report-v1', 'ffff')], { descends: unrelated, image: images });
    expect((await held(cell)).entries[0]?.commit).toBe('ffff');
  });

  it('replaces when nobody can say, and says so', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', 'cccc')], { descends: linear, image: images });
    const result = await publishLine(cell, MAIN, [entry('report-v1', 'dddd')], { descends: linear, image: images });
    expect(result).toMatchObject({ written: ['report-v1'], unanswered: ['report-v1'] });
  });

  it('replaces a branch entry whatever its history, because a rebase leaves none', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, BRANCH, [entry('report-v1', 'cccc')], { descends: linear, image: images });
    await publishLine(cell, BRANCH, [entry('report-v1', 'aaaa')], { descends: linear, image: images });
    expect((await held(cell, BRANCH)).entries[0]?.commit).toBe('aaaa');
  });

  it('keeps two suites published by two jobs at one commit', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('suite-v1/web', 'bbbb')], { descends: linear, image: images });
    await publishLine(cell, MAIN, [entry('suite-v1/app', 'bbbb')], { descends: linear, image: images });
    expect((await held(cell)).entries.map((e) => e.name)).toEqual(['suite-v1/app', 'suite-v1/web']);
  });

  it('keeps a newer format, and a newer version replaces an older one in its slot', async () => {
    variancePrecondition('record', 'newer');
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('suite-v1/web', 'aaaa')], { descends: linear, image: images });
    await publishLine(cell, MAIN, [entry('suite-v2/web', 'aaaa')], { descends: linear, image: images });
    expect((await held(cell)).entries.map((e) => e.name)).toEqual(['suite-v2/web']);
    const old = await publishLine(cell, MAIN, [entry('suite-v1/web', 'cccc')], { descends: linear, image: images });
    expect(old).toMatchObject({ written: [], kept: [{ name: 'suite-v2/web', because: 'newer-format' }] });
  });

  it('reads the line again and decides again when another writer got there first', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('suite-v1/web', 'bbbb')], { descends: linear, image: images });
    let raced = false;
    const racing: LineCell = {
      load: (line) => cell.load(line),
      blob: (line, path) => cell.blob(line, path),
      async store(line, write) {
        if (!raced) {
          raced = true;
          await publishLine(cell, MAIN, [entry('suite-v1/app', 'bbbb')], { descends: linear, image: images });
        }
        return cell.store(line, write);
      },
    };
    const result = await publishLine(racing, MAIN, [entry('report-v1', 'bbbb')], { descends: linear, image: images });
    expect(result).toMatchObject({ written: ['report-v1'], attempts: 2 });
    expect((await held(cell)).entries.map((e) => e.name)).toEqual(['report-v1', 'suite-v1/app', 'suite-v1/web']);
  });

  it('gives up on a line that moves under every write, and publishes nothing', async () => {
    const cell = memoryLineCell();
    const moving: LineCell = { ...cell, load: (line) => cell.load(line), blob: cell.blob, store: async () => 'conflict' };
    const result = await publishLine(moving, MAIN, [entry('report-v1', 'bbbb')], { descends: linear, image: images, attempts: 3 });
    expect(result).toMatchObject({ kind: 'unreachable' });
    expect(await cell.load(MAIN)).toEqual({ kind: 'absent' });
  });

  it('sends an image the line already holds once', async () => {
    const cell = memoryLineCell();
    const asked: string[] = [];
    const image = async (digest: string): Promise<Uint8Array> => {
      asked.push(digest);
      return ascii('png');
    };
    await publishLine(cell, MAIN, [entry('report-v1', 'aaaa', 'one', [IMAGE])], { descends: linear, image });
    await publishLine(cell, MAIN, [entry('report-v1', 'bbbb', 'two', [IMAGE])], { descends: linear, image });
    expect(asked).toEqual([IMAGE]);
    const read = await readLine(cell, MAIN);
    if ('kind' in read) throw new Error(read.kind);
    expect(await read.image(IMAGE)).toEqual(ascii('png'));
  });

  it('leaves a line a newer writer owns alone', async () => {
    const cell = memoryLineCell();
    await cell.store(MAIN, { manifest: ascii('{"format":2,"entries":[]}'), blobs: new Map() });
    const result = await publishLine(cell, MAIN, [entry('report-v1', 'bbbb')], { descends: linear, image: images });
    expect(result).toMatchObject({ kind: 'newer' });
  });

  it('refuses a malformed entry before touching the line', async () => {
    const cell = memoryLineCell();
    await expect(publishLine(cell, MAIN, [entry('report', 'bbbb')], { descends: linear, image: images })).rejects.toThrow(/family/);
  });
});

describe('readLine and findEntry', () => {
  it('tell nothing published from a newer format', async () => {
    variancePrecondition('record', 'newer');
    const cell = memoryLineCell();
    expect(await readLine(cell, MAIN)).toEqual({ kind: 'absent' });
    await publishLine(cell, MAIN, [entry('suite-v2/web', 'bbbb')], { descends: linear, image: images });
    const manifest = await held(cell);
    expect(findEntry(manifest, 'suite-v1/web')).toEqual({ kind: 'newer', names: ['suite-v2/web'] });
    expect(findEntry(manifest, 'suite-v1/app')).toEqual({ kind: 'absent' });
  });

  it('refuses bytes that do not match the digest the manifest names', async () => {
    const cell = memoryLineCell();
    const bytes = ascii('real');
    const digest = entryDigest(bytes);
    const manifest = encodeManifest({ format: 1, entries: [{ name: 'report-v1', commit: 'bbbb', digest, size: 4 }] });
    await cell.store(MAIN, { manifest, blobs: new Map([[`entries/${digest}`, ascii('fake')]]) });
    const read = await readLine(cell, MAIN);
    if ('kind' in read) throw new Error(read.kind);
    expect(await read.entry(read.manifest.entries[0]!)).toMatchObject({ kind: 'unreadable' });
    expect(decodeManifest(manifest)).toMatchObject({ format: 1 });
  });
});
