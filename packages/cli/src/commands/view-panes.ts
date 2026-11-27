// compass: variance-authority.reach.crossings
/**
 * The tabs of the page and what each address shows. An address is `kind/key`,
 * the key percent-encoded; one no tab or row answers says so.
 */

import { historyTab, type History } from './view-history-tables.js';
import type { ViewRecord } from './view-record.js';
import type { Cell, Detail, Table } from './view-rows.js';
import { openSections, type Sections } from './view-raw.js';

export interface Tab {
  readonly id: string;
  readonly label: string;
  tables(): readonly Table[];
  facts(): readonly (readonly [string, Cell])[];
}

export interface Panes {
  readonly tabs: readonly Tab[];
  /** What an address opens by itself; undefined where it names nothing the record holds. */
  detail(kind: string, key: string): Detail | undefined;
}

/** The panes of `record`, recorded for `suite`, and the mainline series `history` where the page carries one. */
export function panesOf(record: ViewRecord, suite: string, history?: History): Panes {
  const { coverage, cases, before, parts } = record;
  let sections: Sections | undefined;
  const raw = (): Sections => (sections ??= openSections(record.bytes));
  const tab = (id: string, label: string, tables: () => readonly Table[], facts: Tab['facts'] = () => []): Tab => ({ id, label, tables, facts });
  const tabs: Tab[] = [];
  const add = (id: string, label: string, table: Table | undefined, more: () => readonly Table[] = () => []): void => {
    if (table !== undefined) tabs.push(tab(id, label, () => [table, ...more()]));
  };
  tabs.push(
    tab('overview', 'Overview', () => [...(coverage?.machines === undefined ? [] : [coverage.machines]), ...parts.parts.flatMap((part) => (part.name === 'cases.last' ? part.tables : []))], () => [
      ['suite', suite],
      ['commit', coverage?.commit],
      ['instrumentation', coverage?.instrumentation],
      ['test files', coverage?.tests.count],
      ['modules', coverage?.modules.count],
      ['regions', coverage?.regions.count],
      ['cases', cases?.count],
      ['machines', coverage?.machinesUnread ?? record.machinesUnread],
      ['bytes', record.bytes.length],
      ...parts.parts.filter((part) => part.name !== 'cases.last').flatMap((part) => part.facts),
    ]),
  );
  add('files', 'Test files', coverage?.tests);
  add('cases', 'Cases', cases?.tests);
  add('timeline', 'Timeline', coverage?.timeline);
  add('modules', 'Modules', coverage?.modules);
  add('regions', 'Regions', coverage?.regions);
  add('preconditions', 'Preconditions', coverage?.preconditions);
  if (before !== undefined) add('before', 'Before the last run', before.tests, () => [before.regions]);
  for (const part of parts.parts) if (part.name !== 'cases.last' && part.tables.length > 0) tabs.push(tab(part.name, part.name, () => part.tables));
  if (history !== undefined) tabs.push(historyTab(history));
  tabs.push(tab('record', 'Record', () => [raw().table]));
  const about = (detail: Detail | undefined, more: readonly Table[]): Detail | undefined => (detail === undefined ? undefined : { ...detail, tables: [...detail.tables, ...more] });
  return {
    tabs,
    detail: (kind, key) => {
      const row = Number(key);
      switch (kind) {
        case 'test':
          return coverage?.testDetail(key);
        case 'module':
          return coverage?.moduleDetail(key);
        case 'region':
          return coverage?.regionDetail(row);
        case 'case': {
          const at = cases?.rowOf(key);
          return at === undefined ? undefined : about(cases!.testDetail(at), parts.ofCase(key));
        }
        case 'before-case': {
          const at = before?.rowOf(key);
          return at === undefined ? undefined : before!.testDetail(at);
        }
        case 'case-region':
          return inside(cases?.regions, row) ? cases!.regionDetail(row) : undefined;
        case 'before-case-region':
          return inside(before?.regions, row) ? before!.regionDetail(row) : undefined;
        case 'section':
          return raw().detail(key);
        default:
          return undefined;
      }
    },
  };
}

const inside = (table: Table | undefined, row: number): boolean => table !== undefined && row >= 0 && row < table.count;
