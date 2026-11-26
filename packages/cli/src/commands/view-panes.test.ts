// compass: variance-authority.reach.crossings
import { encodeTestCoverage, rawRecord } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { panesOf } from './view-panes.js';
import { openRecord } from './view-record.js';
import type { Table } from './view-rows.js';

/** The record as the page reads it: the tabs it offers, the rows they hold, and what an address opens. */

const COVERAGE = {
  version: 3,
  instrumentation: 'fixture',
  tests: [
    { file: 'src/a.test.ts', duration: 40, complete: true, preconditions: [] },
    { file: 'src/b.test.ts', duration: 900, complete: true, preconditions: [] },
  ],
  modules: [
    {
      file: 'src/world.ts',
      sourceDigest: 'd',
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'module' as const, digest: 'm', name: '', path: '', startLine: 1, endLine: 9, source: true, testFiles: ['src/a.test.ts', 'src/b.test.ts'] },
        { ordinal: 1, kind: 'function' as const, digest: 'f', name: 'greet', path: 'greet', startLine: 2, endLine: 4, source: true, testFiles: ['src/b.test.ts'] },
      ],
    },
    {
      file: 'src/split.ts',
      sourceDigest: 's',
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'function' as const, digest: 'x', name: 'one', path: 'one', startLine: 1, endLine: 2, source: true, testFiles: ['src/a.test.ts'] },
        { ordinal: 1, kind: 'function' as const, digest: 'y', name: 'two', path: 'two', startLine: 3, endLine: 4, source: true, testFiles: ['src/b.test.ts'] },
      ],
    },
  ],
};

const panes = panesOf(openRecord(rawRecord(encodeTestCoverage(COVERAGE))), 'unit');
const column = (table: Table, name: string): unknown[] => {
  const at = table.columns.find((held) => held.name === name)!;
  return Array.from({ length: table.count }, (_, row) => at.at(row));
};
const tab = (id: string) => panes.tabs.find((held) => held.id === id)!;

describe('the panes of a record', () => {
  it('offers a tab for each thing the record holds, the overview first and the record last', () => {
    const ids = panes.tabs.map(({ id }) => id);
    expect(ids[0]).toBe('overview');
    expect(ids.at(-1)).toBe('record');
    expect(ids).toEqual(expect.arrayContaining(['files', 'modules', 'regions']));
  });

  it('counts what the record holds on the overview', () => {
    const facts = new Map(tab('overview').facts());
    expect(facts.get('suite')).toBe('unit');
    expect(facts.get('test files')).toBe(2);
    expect(facts.get('modules')).toBe(2);
    expect(facts.get('regions')).toBe(4);
  });

  it('reads every test file with its duration and the regions it entered', () => {
    const [files] = tab('files').tables();
    expect(column(files!, 'test file')).toEqual(['src/a.test.ts', 'src/b.test.ts']);
    expect(column(files!, 'took')).toEqual([40, 900]);
    expect(column(files!, 'regions entered')).toEqual([2, 3]);
  });

  it('counts the test files of a module across all its regions, not its first', () => {
    const [modules] = tab('modules').tables();
    expect(column(modules!, 'module')).toEqual(['src/split.ts', 'src/world.ts']);
    expect(column(modules!, 'test files')).toEqual([2, 2]);
  });

  it('opens a test file and a module by their addresses', () => {
    const test = panes.detail('test', 'src/b.test.ts')!;
    expect(test.title).toBe('src/b.test.ts');
    const entered = test.tables.find(({ id }) => id === 'entered')!;
    expect(column(entered, 'name')).toEqual(['two', '(no name)', 'greet']);
    const module = panes.detail('module', 'src/world.ts')!;
    expect(column(module.tables.find(({ id }) => id === 'into')!, 'test file')).toEqual(['src/a.test.ts', 'src/b.test.ts']);
  });

  it('opens nothing for an address the record does not hold', () => {
    expect(panes.detail('test', 'src/nothing.ts')).toBeUndefined();
    expect(panes.detail('region', '99')).toBeUndefined();
    expect(panes.detail('elsewhere', 'x')).toBeUndefined();
  });
});
