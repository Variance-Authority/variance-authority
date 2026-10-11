import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import journalNames from './jest-journal-name.cjs';
import journalFormat from './journal-format.cjs';
import { journalsOf, oneTestPerFile, projectNamed, readProjectJournals } from './jest-projects.js';
import type { CoverageTest } from './index.js';

const file = 'test/greet.case.ts';

describe('one row for a file several Jest projects ran', () => {
  it('is whole only where every project was', () => {
    const merged = oneTestPerFile([
      { file, complete: true, preconditions: [] },
      { file, complete: false, preconditions: [] },
    ]);
    expect(merged).toEqual([{ file, complete: false, preconditions: [] }]);
  });

  it('holds each project\'s preconditions once, by name', () => {
    const merged = oneTestPerFile([
      { file, complete: true, preconditions: [{ name: file, digest: 'a' }, { name: 'jest.setup.ts', digest: 'b' }] },
      { file, complete: true, preconditions: [{ name: file, digest: 'a' }, { name: 'dom.setup.ts', digest: 'c' }] },
    ]);
    expect(merged[0]?.preconditions).toEqual([
      { name: file, digest: 'a' },
      { name: 'jest.setup.ts', digest: 'b' },
      { name: 'dom.setup.ts', digest: 'c' },
    ]);
  });

  it('costs the sum of what each project spent, unknown where one did not say', () => {
    const timed: CoverageTest = { file, complete: true, preconditions: [], duration: 40 };
    expect(oneTestPerFile([timed, { ...timed, duration: 2 }])[0]?.duration).toBe(42);
    expect(oneTestPerFile([timed, { file, complete: true, preconditions: [] }])[0]).not.toHaveProperty('duration');
  });

  it('leaves a file one project ran as it was', () => {
    const other: CoverageTest = { file: 'test/other.case.ts', complete: true, preconditions: [], duration: 3 };
    expect(oneTestPerFile([{ file, complete: false, preconditions: [] }, other])).toEqual([
      { file, complete: false, preconditions: [] },
      other,
    ]);
  });
});

describe('the journals of a Jest run directory', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'variance-authority-jest-projects-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('each carry the project whose sandbox wrote them', async () => {
    await writeFile(join(directory, journalNames.journalName('1-a', 'runs')), journalFormat.encodeJournal('/r/test/a.ts', new Map()));
    await writeFile(join(directory, journalNames.journalName('1-b', undefined)), journalFormat.encodeJournal('/r/test/b.ts', new Map()));
    const read = await readProjectJournals(directory);
    expect(read.map((written) => [written.journal.testFile, written.project])).toEqual([
      ['/r/test/a.ts', 'runs'],
      ['/r/test/b.ts', undefined],
    ]);
  });

  it('give a result only its own project\'s, and none where that project wrote none', () => {
    const journal = { testFile: '/r/test/a.ts', modules: [] };
    const written = [{ journal, project: 'runs' }];
    expect(journalsOf(written, projectNamed('runs'))).toEqual([journal]);
    expect(journalsOf(written, projectNamed({ name: 'skips', color: 'blue' }))).toEqual([]);
    expect(journalsOf(written, projectNamed(undefined))).toEqual([]);
  });
});
