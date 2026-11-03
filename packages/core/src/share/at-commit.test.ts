import { describe, expect, it } from 'vitest';
import { linePath, type ShareEntry } from './line.js';
import { atCommit, purgeKept } from './at-commit.js';
import { findEntry, memoryLineCell, publishLine, readLine } from './publish.js';

const MAIN = { kind: 'mainline', name: 'main' } as const;
const DAY = 24 * 60 * 60 * 1000;
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry = (name: string, commit: string): ShareEntry => ({ name, commit, bytes: ascii(`${name}@${commit}`) });
const options = { descends: async () => undefined, image: async () => ascii('png') };
const sha = (index: number): string => index.toString(16).padStart(40, '0');

describe('a mainline record kept at its commit', () => {
  it('sits beside the line, under the commit first, so no line name can reach it', () => {
    expect(linePath(atCommit(MAIN, sha(1)))).toBe(`at/${sha(1)}/mainline/main`);
    expect(linePath(atCommit({ kind: 'mainline', name: 'release/2.0' }, sha(1)))).toBe(`at/${sha(1)}/mainline/release/2.0`);
  });

  it('stays readable after the mainline moves on', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], options);
    await publishLine(cell, MAIN, [entry('report-v1', sha(2))], options);
    const read = await readLine(cell, atCommit(MAIN, sha(1)));
    if ('kind' in read) throw new Error(read.kind);
    const found = findEntry(read.manifest, 'report-v1');
    if ('kind' in found) throw new Error(found.kind);
    expect(await read.entry(found)).toEqual(ascii(`report-v1@${sha(1)}`));
  });

  it('gathers what different jobs publish at one commit', async () => {
    const cell = memoryLineCell();
    await publishLine(cell, MAIN, [entry('suite-v1/unit', sha(1))], options);
    await publishLine(cell, MAIN, [entry('suite-v1/web', sha(1))], options);
    const read = await readLine(cell, atCommit(MAIN, sha(1)));
    if ('kind' in read) throw new Error(read.kind);
    expect(read.manifest.entries.map((held) => held.name).sort()).toEqual(['suite-v1/unit', 'suite-v1/web']);
  });

  it('removes nothing on a publish, however old what it keeps', async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], options);
    now = 10_000 * DAY;
    await publishLine(cell, MAIN, [entry('report-v1', sha(2))], options);
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).not.toHaveProperty('kind');
  });

  it('removes what was written before the time asked for, and leaves the latest', async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], options);
    now = 2 * DAY;
    await publishLine(cell, MAIN, [entry('report-v1', sha(2))], options);
    expect(await purgeKept(cell, MAIN, DAY)).toEqual([sha(1)]);
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).toEqual({ kind: 'absent' });
    expect(await readLine(cell, atCommit(MAIN, sha(2)))).not.toHaveProperty('kind');
    expect(await readLine(cell, MAIN)).not.toHaveProperty('kind');
  });

  it('removes nothing when a record is written after it was listed', async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], options);
    now = 2 * DAY;
    const racing = {
      ...cell,
      commits: async (line: Parameters<NonNullable<typeof cell.commits>>[0]) => {
        const listed = await cell.commits!(line);
        await publishLine(cell, atCommit(MAIN, sha(1)), [entry('report-v2', sha(1))], options);
        return listed;
      },
    };
    expect(await purgeKept(racing, MAIN, DAY)).toBe('conflict');
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).not.toHaveProperty('kind');
  });

  it('keeps nothing by commit for a branch, or in a store that cannot list what it keeps', async () => {
    const cell = memoryLineCell();
    expect(await publishLine(cell, { kind: 'branch', name: 'feat/x' }, [entry('report-v1', sha(1))], options)).not.toHaveProperty('atCommit');
    expect(await cell.commits!({ kind: 'branch', name: 'feat/x' })).toEqual([]);
    const { commits: _commits, drop: _drop, ...latestOnly } = cell;
    expect(await purgeKept(latestOnly, MAIN, DAY)).toEqual([]);
    expect(await publishLine(latestOnly, MAIN, [entry('report-v1', sha(1))], options)).not.toHaveProperty('atCommit');
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).toEqual({ kind: 'absent' });
    expect(await readLine(cell, MAIN)).not.toHaveProperty('kind');
  });

  it('keeps the record at its commit even when the latest keeps a newer one', async () => {
    const cell = memoryLineCell();
    const newer = { ...options, descends: async () => true };
    await publishLine(cell, MAIN, [entry('report-v1', sha(2))], newer);
    const late = await publishLine(cell, MAIN, [entry('report-v1', sha(1))], newer);
    expect(late).toMatchObject({ written: [], atCommit: { kept: [sha(1)] } });
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).not.toHaveProperty('kind');
  });
});
