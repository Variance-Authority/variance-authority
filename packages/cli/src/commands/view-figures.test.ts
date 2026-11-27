// compass: variance-authority.reach.crossings
import { encodeTestCoverage, rawRecord, recordOfCases, withCaseSections } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
// Sense publishes the case index's readers and not its writer, which only a
// recording run calls, so this writes a record the way that run does.
import { encodeAsSetExecutionIndex } from '../../../sense/src/test-selection/execution-set-format.js';
import type { MachinesBeside } from '@variance-authority/sense';
import { panesOf } from './view-panes.js';
import { openRecord } from './view-record.js';
import type { Table } from './view-rows.js';

/** What surrounded a run, as the page shows it: each line's load and memory, and the machine each test file ran on. */

const commit = 'c'.repeat(40);

const COVERAGE = {
  version: 3,
  instrumentation: 'fixture',
  commit,
  tests: [
    { file: 'src/a.test.ts', duration: 40, complete: true, preconditions: [] },
    { file: 'src/b.test.ts', duration: 900, complete: true, preconditions: [] },
    { file: 'src/c.test.ts', duration: 7, complete: true, preconditions: [] },
  ],
  modules: [],
};

const CASES = {
  tests: [
    {
      id: 'a',
      file: 'src/a.test.ts',
      name: 'waits',
      duration: 30,
      times: [
        { line: 4, time: 20_000, load: 3.99, rss: 1154, free: 12057, added: 40 },
        { line: 5, time: 12, load: 1.5, rss: 1200 },
      ],
    },
    { id: 'b', file: 'src/b.test.ts', name: 'uncut', duration: 100 },
  ],
  modules: [],
};

const panes = (ran?: MachinesBeside) =>
  panesOf(openRecord(rawRecord(withCaseSections(encodeTestCoverage(COVERAGE), { index: encodeAsSetExecutionIndex(CASES) })), ran), 'unit');
const column = (table: Table, name: string): unknown[] | undefined => {
  const at = table.columns.find((held) => held.name === name);
  return at === undefined ? undefined : Array.from({ length: table.count }, (_, row) => at.at(row));
};
const tab = (from: ReturnType<typeof panes>, id: string) => from.tabs.find((held) => held.id === id)!;

describe('the figures around each line of a case', () => {
  it('shows each line\'s load, RSS, free memory and nodes added beside its time, blank where it was not read', () => {
    const times = panes().detail('case', 'a')!.tables.find(({ id }) => id === 'times')!;

    expect(times.columns.map(({ name }) => name)).toEqual(['line', 'µs', '% of the case', 'load', 'RSS MiB', 'free MiB', 'nodes added']);
    expect(column(times, 'load')).toEqual([3.99, 1.5]);
    expect(column(times, 'RSS MiB')).toEqual([1154, 1200]);
    expect(column(times, 'free MiB')).toEqual([12057, undefined]);
    expect(column(times, 'nodes added')).toEqual([40, undefined]);
  });

  it('shows the highest load and RSS a case\'s lines ended at, blank for a case not timed', () => {
    const [cases] = tab(panes(), 'cases').tables();

    expect(column(cases!, 'peak load')).toEqual([3.99, undefined]);
    expect(column(cases!, 'peak RSS MiB')).toEqual([1200, undefined]);
  });
});

describe('the machine each test file ran on', () => {
  const ran: MachinesBeside = { files: { 'src/a.test.ts': 'x64, 2 cores', 'src/b.test.ts': 'arm64, 12 cores' } };

  it('names each file\'s machine in Test files, blank where the runs name none', () => {
    const [files] = tab(panes(ran), 'files').tables();

    expect(column(files!, 'machine')).toEqual(['x64, 2 cores', 'arm64, 12 cores', undefined]);
  });

  it('lists the run\'s machines on the overview, with how many test files each ran', () => {
    const machines = tab(panes(ran), 'overview').tables().find(({ id }) => id === 'machines')!;

    expect(column(machines, 'machine')).toEqual(['arm64, 12 cores', 'x64, 2 cores', '(none named)']);
    expect(column(machines, 'test files')).toEqual([1, 1, 1]);
  });

  it('names no machine where none were read, and says why where the runs gave a reason', () => {
    for (const [other, why] of [
      [{ unread: 'the runs record beside it stands at another commit' }, 'the runs record beside it stands at another commit'],
      [undefined, undefined],
    ] as const) {
      const shown = panes(other);
      expect(column(tab(shown, 'files').tables()[0]!, 'machine')).toBeUndefined();
      expect(tab(shown, 'overview').tables().find(({ id }) => id === 'machines')).toBeUndefined();
      expect(new Map(tab(shown, 'overview').facts()).get('machines')).toBe(why);
    }
  });

  it('says why no machine is counted on a record that holds cases and no test files', () => {
    const facts = (ran: MachinesBeside) =>
      new Map(tab(panesOf(openRecord(recordOfCases({ index: encodeAsSetExecutionIndex(CASES) }), ran), 'unit'), 'overview').facts()).get('machines');

    expect(facts(ran)).toBe('the record holds no test files to count the machines against');
    expect(facts({ unread: 'the runs record beside it names no machine' })).toBe('the runs record beside it names no machine');
  });
});
