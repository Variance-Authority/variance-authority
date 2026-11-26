// compass: variance-authority.reach.crossings
/** The record's case index as tables: each case, and each region a case entered. */

import { BLOCK_KINDS, lineAt, linesOf, members, NO_OWNER, openSetColumns, shareOf, testAt, type SetColumns } from '@variance-authority/sense/record';
import { address, each, entered, enteredCounts, gathered, listed, once, ownerOf, rowsOf, unless, yes, type Detail, type Sets, type Table } from './view-rows.js';

/** One case index, opened. */
export interface Cases {
  readonly count: number;
  readonly tests: Table;
  readonly regions: Table;
  /** A test file's cases. */
  ofFile(file: string): readonly number[];
  /** A module's regions. */
  ofModule(module: string): readonly number[];
  rowOf(id: string): number | undefined;
  idAt(row: number): string;
  nameAt(row: number): string;
  testDetail(row: number): Detail;
  regionDetail(row: number): Detail;
}

/** The index at `bytes`, its addresses prefixed with `prefix`; undefined where there is none to open. */
export function openCases(bytes: Uint8Array, prefix: string, label: string): Cases | undefined {
  const columns = openSetColumns(bytes);
  return columns === undefined ? undefined : casesOf(columns, prefix, label);
}

interface Heard {
  readonly [facet: string]: readonly (readonly [string, string | null, string, number])[];
}

function casesOf(columns: SetColumns, prefix: string, label: string): Cases {
  const decoder = new TextDecoder();
  const { blob, offsets } = columns.strings;
  const string = each((id) => decoder.decode(blob.subarray(offsets[id]!, offsets[id + 1]!)));
  const count = columns.testId.length;
  const id = (row: number) => string(columns.testId[row]!);
  const name = (row: number) => string(columns.testName[row]!);
  const file = (row: number) => string(columns.testFile[row]!);
  const test = (row: number) => testAt(columns, row, string);
  const heard = each((row): Heard => {
    const said = columns.testSaid?.[row];
    return said === undefined ? {} : (JSON.parse(said) as Heard);
  });
  const heardCount = (facet: string) => (row: number) => heard(row)[facet]?.length;
  const sets: Sets = {
    size: columns.sets.size,
    has: (set, member) => columns.sets.has(set, member),
    count: each((set) => columns.sets.count(set)),
    members: (set) => members(columns.sets, set, count),
  };
  const perCase = once(() => enteredCounts(sets, columns.blockCalled, count));
  const moduleOf = (row: number) => ownerOf(columns.moduleBlocks, row);
  const modulePath = (row: number) => string(columns.moduleFile[moduleOf(row)]!);
  const lines = (row: number) => {
    const [start, end] = [columns.blockStart[row]!, columns.blockEnd[row]!];
    return start === 0 ? undefined : start === end ? String(start) : `${start}-${end}`;
  };
  const tests: Table = {
    id: `${prefix}cases`,
    label,
    hint: 'each case the runner reported, and what the record holds of it',
    count,
    columns: [
      { name: 'case', at: name, link: (row) => address(`${prefix}case`, id(row)) },
      { name: 'test file', at: file, link: (row) => address('test', file(row)) },
      { name: 'took', as: 'ms', at: (row) => test(row).duration },
      { name: 'limit', as: 'ms', at: (row) => test(row).limit },
      { name: 'ended', at: (row) => [undefined, 'finished', 'stopped'][columns.testStopped?.[row] ?? 0] },
      { name: 'regions entered', at: (row) => perCase()[row] },
      { name: 'lines timed', at: (row) => test(row).times?.length },
      { name: 'said', at: heardCount('said') },
      { name: 'read', at: heardCount('read') },
      { name: 'misused', at: heardCount('misused') },
    ],
  };
  const regions: Table = {
    id: `${prefix}case-regions`,
    label: 'Regions by case',
    hint: 'each region the case index holds, and how many cases entered it',
    count: columns.blockKind.length,
    columns: [
      { name: 'module', at: modulePath, link: (row) => address('module', modulePath(row)) },
      { name: 'kind', at: (row) => kindName(columns.blockKind[row]!) },
      { name: 'name', at: (row) => string(columns.blockName[row]!), link: (row) => address(`${prefix}case-region`, row) },
      { name: 'path', at: (row) => string(columns.blockPath[row]!) },
      { name: 'lines', at: lines },
      { name: 'cases', at: (row) => sets.count(columns.blockCalled[row]!) },
      { name: 'cases not known', at: (row) => (columns.blockOverwritten === undefined ? undefined : sets.count(columns.blockOverwritten[row]!)) },
      { name: 'at load', at: (row) => yes(columns.blockLoaded[row]!) },
      { name: 'written in source', at: (row) => yes(columns.blockSource[row]!) },
    ],
  };
  const byFile = once(() => gathered(count, file));
  const byId = once(() => gathered(count, id));
  const byModule = once(() => new Map(Array.from(columns.moduleFile, (path, at) => [string(path), at] as const)));
  return {
    count,
    tests,
    regions,
    ofFile: (path) => byFile().get(path) ?? [],
    ofModule: (path) => {
      const at = byModule().get(path);
      return at === undefined ? [] : Array.from({ length: columns.moduleBlocks[at + 1]! - columns.moduleBlocks[at]! }, (_, row) => columns.moduleBlocks[at]! + row);
    },
    rowOf: (key) => byId().get(key)?.[0],
    idAt: id,
    nameAt: name,
    testDetail: (row) => {
      const held = test(row);
      const written = linesOf(columns.testLines, row);
      const rows = entered(sets, columns.blockCalled, row);
      const reached = rowsOf(regions, rows, { id: `${prefix}entered`, label: 'Regions entered', hint: 'what this case ran' });
      const firstLine = (at: number) => {
        const block = rows[at]!;
        const module = moduleOf(block);
        const found = written === undefined ? undefined : lineAt(written, module, block - columns.moduleBlocks[module]!);
        return found === undefined ? undefined : found.ambient ? `${found.line} (ambient)` : found.line;
      };
      return {
        title: name(row),
        facts: [
          ['id', id(row)],
          ['test file', file(row)],
          ['took', held.duration, 'ms'],
          ['limit', held.limit, 'ms'],
          ['ended', tests.columns[4]!.at(row)],
        ],
        tables: [
          { ...reached, columns: [...reached.columns, { name: 'from test line', at: firstLine }] },
          listed(
            { id: `${prefix}times`, label: 'Time by line', hint: 'the time each line of the test took' },
            ['line', 'µs', '% of the case'],
            (held.times ?? []).map((line) => [line.line, line.time, shareOf(line.time, held.duration)]),
          ),
          ...Object.entries(heard(row)).map(([facet, items]) =>
            listed({ id: `${prefix}${facet}`, label: facet, hint: `what the case ${facet}` }, ['name', 'value', 'site', 'level'], items.map(([key, value, site, level]) => [key, value ?? undefined, site, level])),
          ),
        ],
      };
    },
    regionDetail: (row) => {
      const at = moduleOf(row);
      const owner = columns.blockOwner === undefined ? undefined : unless(columns.blockOwner[row], NO_OWNER);
      return {
        title: string(columns.blockName[row]!) || `${kindName(columns.blockKind[row]!)} in ${modulePath(row)}`,
        facts: [
          ...regions.columns.map((column) => [column.name, column.at(row)] as const),
          ['inside', owner === undefined ? undefined : string(columns.blockName[columns.moduleBlocks[at]! + owner]!)],
        ],
        tables: [
          rowsOf(tests, sets.members(columns.blockCalled[row]!), { id: `${prefix}by`, label: 'Cases that entered it', hint: 'every case whose run reached this region' }),
          ...(columns.blockOverwritten === undefined
            ? []
            : [rowsOf(tests, sets.members(columns.blockOverwritten[row]!), { id: `${prefix}overwritten`, label: 'Cases not known to cross it', hint: 'carried here from a region an edit reached, where they ran another text' })]),
        ],
      };
    },
  };
}

/** A region's kind by name. */
export const kindName = (kind: number): string => BLOCK_KINDS[kind] ?? `kind ${kind}`;
