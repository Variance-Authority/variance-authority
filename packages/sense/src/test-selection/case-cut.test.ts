import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cutFiles, cutOf, removeCut, writeCut } from './case-cut.js';
import { selectedLines, type SuiteSelection } from './suite-selection.js';

const selection = (cases?: SuiteSelection['cases']): SuiteSelection => ({
  whole: new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts']),
  skip: new Set(['test/c.test.ts']),
  ...(cases === undefined ? {} : { cases }),
  notes: [],
});

describe('the cases a run is handed to skip', () => {
  it('names, by the absolute path the runner keeps, the cut of each file it runs', () => {
    const cut = cutOf(selection(new Map([['test/a.test.ts', ['one']], ['test/b.test.ts', []]])), ['/repo/test/a.test.ts', '/repo/test/b.test.ts'], '/repo');

    expect(cut).toEqual(new Map([['/repo/test/a.test.ts', ['one']]]));
  });

  it('cuts nothing at the file grain', () => {
    expect(cutOf(selection(), ['/repo/test/a.test.ts'], '/repo')).toEqual(new Map());
  });

  it('carries the files it cuts through the disk, and none once removed or never written', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'va-cut-')), 'run', 'cut.json');
    expect(cutFiles(file)).toEqual(new Set());
    expect(cutFiles(undefined)).toEqual(new Set());

    writeCut(file, new Map([['/repo/test/a.test.ts', ['one']]]));
    expect(cutFiles(file)).toEqual(new Set(['/repo/test/a.test.ts']));

    removeCut(file);
    expect(cutFiles(file)).toEqual(new Set());
  });

  it('refuses a cut it cannot read, rather than running every case', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'va-cut-')), 'cut.json');
    writeFileSync(file, '{');

    expect(() => cutFiles(file)).toThrow(SyntaxError);
  });
});

describe('what a selected run says about itself', () => {
  const discovered = ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'];

  it('says how many cases it skips, and in how many of the files it runs', () => {
    const cases = new Map([['test/a.test.ts', ['one', 'two']], ['test/b.test.ts', ['three']], ['test/c.test.ts', ['four']]]);

    expect(selectedLines(selection(cases), discovered)).toEqual(['variance-authority: selected 2 of 3, skipping 3 cases in 2 of them']);
  });

  it('says nothing of cases at the file grain', () => {
    expect(selectedLines(selection(), discovered)).toEqual(['variance-authority: selected 2 of 3']);
  });
});
