import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, keepsCases, recordedEyesAt, withoutCoverage } from './case-record.js';
import { commitRunsFile, landRun } from './commit-runs.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { DURATION, NAMES } from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { decodeTestCoverage } from './format.js';
import { narrowByExecution, writeTestCoverage, type TestCoverage } from './index.js';

/**
 * A run that keeps its cases and instruments no module (spec 0094, item 2): its
 * record holds the cases and no coverage, and a reader answers *unmeasured*.
 */

const COMMIT = 'c'.repeat(40);

/** A case index naming one case of `a.test.ts`, which called nothing. */
function index(): Buffer {
  const sets = new CrossingSets(1);
  sets.intern([]);
  return encodeSetExecutionIndex({ tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }], modules: [], sets: sets.pool() });
}

/** A run of `a.test.ts` at `COMMIT` that instrumented no module. */
const uninstrumented: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  commit: COMMIT,
  tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
  modules: [],
};

const fresh = () => ({ fresh: index(), run: { tests: [{ file: 'a.test.ts', complete: true }], commit: COMMIT } });

/** The section names the header of the record at `file` lists. */
function sectionNames(file: string): string[] {
  const bytes = readFileSync(file);
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString('utf8', 4, 4 + length).replace(/\0+$/u, '')) as { sections: { name: string }[] };
  return header.sections.map((section) => section.name);
}

const COVERAGE_SECTIONS = new Set<string>([...NAMES, DURATION]);

let root: string;
let record: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-record-without-coverage-'));
  await writeFile(join(root, 'a.test.ts'), '');
  record = join(root, 'coverage.bin');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('an uninstrumented run that keeps cases', () => {
  it('writes the record with its case sections and no coverage section', async () => {
    await landRun(record, uninstrumented, root, undefined, fresh());

    const names = sectionNames(record);
    expect(names).toEqual(expect.arrayContaining(['cases', 'cases.last']));
    expect(names.filter((name) => COVERAGE_SECTIONS.has(name))).toEqual([]);
    expect(caseSectionsAt(record).index).toBeDefined();
    // It measured nothing, so it claims no test stands at its commit.
    expect(existsSync(commitRunsFile(record))).toBe(false);
  });

  it('keeps the Eyes its cases handed beside them', async () => {
    const eyes = { watched: ['a.test.ts > one'], journals: [{ case: 'a.test.ts > one', attempt: 1, journal: { complete: true } }] };
    await landRun(record, uninstrumented, root, undefined, { ...fresh(), eyes });

    expect(recordedEyesAt(record)).toEqual(eyes);
  });

  it('carries the coverage of the record it lands over as it was, under its own cases', async () => {
    const covered: TestCoverage = { ...uninstrumented, commit: 'b'.repeat(40), tests: [{ file: 'b.test.ts', complete: true, preconditions: [] }] };
    await writeTestCoverage(record, covered);
    const before = decodeTestCoverage(readFileSync(record));

    await landRun(record, uninstrumented, root, undefined, fresh());

    expect(decodeTestCoverage(readFileSync(record))).toEqual(before);
    expect(caseSectionsAt(record).index).toBeDefined();
  });

  it('lands a file it could not finish measuring, which selects it, and not the files it finished', async () => {
    // Probes fired in `b.test.ts` where nothing could place them: the fold left
    // it incomplete, so a later run may not skip it on the earlier record.
    await writeTestCoverage(record, {
      ...uninstrumented,
      tests: [{ file: 'b.test.ts', complete: true, preconditions: [] }],
      modules: [{ file: 'src/b.ts', sourceDigest: 'd', instrumented: false, blocks: [] }],
    });

    await landRun(record, {
      ...uninstrumented,
      tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }, { file: 'b.test.ts', complete: false, preconditions: [] }],
    }, root);

    expect(decodeTestCoverage(readFileSync(record)).tests.map((test) => [test.file, test.complete])).toEqual([['b.test.ts', false]]);
  });

  it('writes nothing when it keeps no cases and there is no record to land over', async () => {
    await landRun(record, uninstrumented, root);
    expect(existsSync(record)).toBe(false);
  });
});

describe('a record without coverage', () => {
  it('is refused by the coverage reader as unmeasured, not read as a record of nothing', async () => {
    await landRun(record, uninstrumented, root, undefined, fresh());
    expect(() => openTestCoverage(readFileSync(record))).toThrow(RecordWithoutCoverage);
  });

  it('is laid over by a covered run as nothing to lay over, and keeps the cases', async () => {
    await landRun(record, uninstrumented, root, undefined, fresh());
    const covered: TestCoverage = { ...uninstrumented, modules: [{ file: 'src/a.ts', sourceDigest: 'd', instrumented: false, blocks: [] }] };

    await landRun(record, covered, root);

    expect(decodeTestCoverage(readFileSync(record)).tests.map((test) => test.file)).toEqual(['a.test.ts']);
    expect(caseSectionsAt(record).index).toBeDefined();
  });

  it('is not answered from a header the file ends inside, which a reader refuses on its own terms', async () => {
    await landRun(record, uninstrumented, root, undefined, fresh());
    const whole = readFileSync(record);
    const header = whole.readUInt32LE(0);
    await writeFile(record, whole.subarray(0, 4 + Math.floor(header / 2)));

    expect(withoutCoverage(record)).toBe(false);
    expect(keepsCases(record)).toBe(false);
  });

  it('is not answered from a file that ends before its header length does, as one that ends inside its header', async () => {
    await landRun(record, uninstrumented, root, undefined, fresh());
    await writeFile(record, readFileSync(record).subarray(0, 3));

    expect(withoutCoverage(record)).toBe(false);
    expect(keepsCases(record)).toBe(false);
  });

  it('narrows nothing: selection answers that it read no record', async () => {
    await landRun(record, uninstrumented, root, undefined, fresh());
    await expect(narrowByExecution(record, '')).rejects.toBeInstanceOf(RecordWithoutCoverage);
  });
});
