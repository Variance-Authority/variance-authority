import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { report } from './commands/push-fixture.js';
import {
  REPORT_ENTRY,
  frame,
  readReportEntry,
  readSuiteEntry,
  reportEntryOf,
  suiteEntryOf,
  unframe,
} from './share-entries.js';

const AT = { commit: 'a'.repeat(40), head: 'b'.repeat(40) } as const;
const PNG = Buffer.from('after-pixels');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

let dir: string;
let cache: string;
let previous: string | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'variance-share-entries-'));
  cache = await mkdtemp(join(tmpdir(), 'variance-share-entries-cache-'));
  previous = process.env['XDG_CACHE_HOME'];
  process.env['XDG_CACHE_HOME'] = cache;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
  else process.env['XDG_CACHE_HOME'] = previous;
  await rm(dir, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

describe('a report as a `report-v1` entry', () => {
  it('holds the report byte for byte, and the digest of each image it names', async () => {
    const at = join(dir, 'out', 'report.json');
    await mkdir(join(dir, 'out', 'images'), { recursive: true });
    const text = JSON.stringify(report({ after: 'images/card.png', before: 'images/card.before.png' }));
    await writeFile(at, text);
    await writeFile(join(dir, 'out', 'images', 'card.png'), PNG);

    const { entry, images, leftOut } = await reportEntryOf(at, AT);

    expect(entry).toMatchObject({ name: REPORT_ENTRY, commit: AT.commit, head: AT.head, images: [sha(PNG)] });
    expect(images).toEqual([{ digest: sha(PNG), path: join(dir, 'out', 'images', 'card.png') }]);
    expect(leftOut).toEqual([join(dir, 'out', 'images', 'card.before.png')]);
    const read = readReportEntry(entry.bytes);
    if (typeof read === 'string') throw new Error(read);
    expect(new TextDecoder().decode(read.report)).toBe(text);
    // The baseline the disk does not hold is left out, not guessed at.
    expect(read.images).toEqual({ 'images/card.png': sha(PNG) });
  });
});

describe('a suite as a `suite-v1/<suite>` entry', () => {
  async function recorded(name: string, commit?: string): Promise<{ readonly root: string; readonly coverage: string }> {
    const root = join(dir, name);
    await mkdir(root, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    const coverage = testCoverageFile(root, { suite: 'unit' });
    await mkdir(dirname(coverage), { recursive: true });
    await writeTestCoverage(coverage, { version: 3, instrumentation: 'fixture', ...(commit === undefined ? {} : { commit }), tests: [], modules: [] });

    return { root, coverage };
  }

  it('holds the coverage record and its per-case index, and no names table', async () => {
    const { root, coverage } = await recorded('repo', AT.commit);
    await writeFile(`${coverage}.cases.bin`, 'cases');

    const entry = await suiteEntryOf(root, 'unit', { commit: AT.commit });

    if (entry === undefined || 'unpublished' in entry) throw new Error(`not published: ${JSON.stringify(entry)}`);
    expect(entry).toMatchObject({ name: 'suite-v1/unit', commit: AT.commit });
    const parts = unframe(entry.bytes);
    expect(typeof parts === 'string' ? parts : [...parts.keys()]).toEqual(['coverage.bin', 'coverage.bin.cases.bin']);
    const read = readSuiteEntry(entry.bytes);
    if (typeof read === 'string') throw new Error(read);
    expect(Buffer.from(read.coverage).equals(await readFile(coverage))).toBe(true);
    expect(new TextDecoder().decode(read.cases)).toBe('cases');
  });

  it('is not published under a commit other than the one the record names, and says which it names', async () => {
    const { root, coverage } = await recorded('stale', 'c'.repeat(40));

    expect(await suiteEntryOf(root, 'unit', { commit: AT.commit })).toEqual({
      unpublished: `its record at ${coverage} was recorded at ${'c'.repeat(40)}, not at ${AT.commit}`,
    });
  });

  it('is not published when the record names no commit', async () => {
    const { root, coverage } = await recorded('nowhere');

    expect(await suiteEntryOf(root, 'unit', { commit: AT.commit })).toEqual({ unpublished: `its record at ${coverage} names no commit` });
  });

  it('is not published when the record does not read, and says why', async () => {
    const { root, coverage } = await recorded('torn', AT.commit);
    await writeFile(coverage, 'rows');

    const entry = await suiteEntryOf(root, 'unit', { commit: AT.commit });

    const why = entry !== undefined && 'unpublished' in entry ? entry.unpublished : JSON.stringify(entry);
    expect(why).toContain(`its record at ${coverage} does not read: `);
  });

  it('is absent for a suite that has recorded nothing here, never empty', async () => {
    const root = join(dir, 'bare');
    await mkdir(root, { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));

    expect(await suiteEntryOf(root, 'unit', { commit: AT.commit })).toBeUndefined();
  });
});

describe('the frame both entries share', () => {
  it('refuses bytes whose length disagrees with the header, rather than reading a part short', () => {
    const framed = frame([['a', new Uint8Array([1, 2, 3])]]);

    expect(unframe(framed.subarray(0, framed.byteLength - 1))).toBe('the entry is shorter than its header says, at a');
    expect(unframe(new Uint8Array([...framed, 9]))).toBe('the entry is longer than its header says');
    expect(unframe(new Uint8Array([1, 2]))).toBe('the entry has no header line');
  });
});
