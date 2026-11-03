import { describe, expect, it } from 'vitest';
import { linePath, type ShareEntry } from './line.js';
import { KEEP_COMMITS, KEEP_DAYS, atCommit } from './at-commit.js';
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

  it(`drops what is older than ${String(KEEP_DAYS)} days`, async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], { ...options, now });
    now = (KEEP_DAYS + 1) * DAY;
    const done = await publishLine(cell, MAIN, [entry('report-v1', sha(2))], { ...options, now });
    expect(done).toMatchObject({ written: ['report-v1'], atCommit: { kept: [sha(2)], dropped: [sha(1)] } });
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).toEqual({ kind: 'absent' });
  });

  it(`keeps at most ${String(KEEP_COMMITS)} commits, the newest`, async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    for (let index = 1; index <= KEEP_COMMITS + 1; index += 1) {
      now = index;
      await publishLine(cell, MAIN, [entry('report-v1', sha(index))], { ...options, now });
    }
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).toEqual({ kind: 'absent' });
    expect(await readLine(cell, atCommit(MAIN, sha(2)))).not.toHaveProperty('kind');
  });

  it('says what it kept when removing what is past the window misses', async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], { ...options, now });
    now = (KEEP_DAYS + 1) * DAY;
    const refused = { ...cell, drop: async () => ({ kind: 'unreachable', detail: 'refused' }) as const };
    const done = await publishLine(refused, MAIN, [entry('report-v1', sha(2))], { ...options, now });
    expect(done).toMatchObject({ atCommit: { kept: [sha(2)], dropped: [], miss: { kind: 'unreachable' } } });
  });

  it('keeps a record written past the window after it was listed, and drops it no sooner than the next publish', async () => {
    let now = 0;
    const cell = memoryLineCell(() => now);
    await publishLine(cell, MAIN, [entry('report-v1', sha(1))], { ...options, now });
    now = (KEEP_DAYS + 1) * DAY;
    // A late job at `sha(1)` writes its record between the listing and the removal.
    let late = false;
    const racing = {
      ...cell,
      commits: async (line: Parameters<NonNullable<typeof cell.commits>>[0]) => {
        const listed = await cell.commits!(line);
        if (!late) {
          late = true;
          await publishLine(cell, atCommit(MAIN, sha(1)), [entry('report-v1', sha(1))], { ...options, now });
        }
        return listed;
      },
    };
    const done = await publishLine(racing, MAIN, [entry('report-v1', sha(2))], { ...options, now });
    expect(done).toMatchObject({ atCommit: { kept: [sha(2)], dropped: [] } });
    expect(await readLine(cell, atCommit(MAIN, sha(1)))).not.toHaveProperty('kind');
  });

  it('keeps nothing by commit for a branch, or in a store that cannot list and drop what it keeps', async () => {
    const cell = memoryLineCell();
    expect(await publishLine(cell, { kind: 'branch', name: 'feat/x' }, [entry('report-v1', sha(1))], options)).not.toHaveProperty('atCommit');
    expect(await cell.commits!({ kind: 'branch', name: 'feat/x' })).toEqual([]);
    const { commits: _commits, drop: _drop, ...latestOnly } = cell;
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
