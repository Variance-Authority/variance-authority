// compass: variance-authority.reach.crossings
/**
 * The parts of a record that are neither coverage nor a case index: what a
 * retried attempt ended with, what the eyes journals hold, what the last run
 * was, and what each case read before. Each is shown as it is stored.
 */

import { decodeCase, decodeReadings } from '@variance-authority/sense/record';
import { listed, once, type Cell, type Table } from './view-rows.js';
import type { Cases } from './view-cases.js';

/** One part, as facts and tables. */
export interface Part {
  readonly name: string;
  readonly facts: readonly (readonly [string, Cell])[];
  readonly tables: readonly Table[];
}

export interface Parts {
  readonly parts: readonly Part[];
  /** What every part holds about one case. */
  ofCase(id: string): readonly Table[];
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type Fields = { readonly [key: string]: Json };

const JSON_PARTS = ['cases.attempts', 'cases.last', 'eyes', 'run.checks'] as const;

/** The parts `part` reads by name; a part the record lacks is left out. */
export function openParts(part: (name: string) => Uint8Array | undefined, cases: Cases | undefined): Parts {
  const texts = new TextDecoder();
  const held: Part[] = [];
  const parsed = new Map<string, Json>();
  for (const name of JSON_PARTS) {
    const bytes = part(name);
    if (bytes === undefined) continue;
    const value = JSON.parse(texts.decode(bytes)) as Json;
    parsed.set(name, value);
    held.push(partOf(name, value));
  }
  const base = part('run.base');
  if (base !== undefined) held.push({ name: 'run.base', facts: [['run.base', texts.decode(base)]], tables: [] });
  const bytes = part('cases.readings');
  const readings = once(() => (bytes === undefined ? undefined : decodeReadings(bytes)));
  const byCase = once(() => new Map([...(readings()?.cases ?? [])].map(([id, stored]) => [id, decodeCase(stored)] as const)));
  if (bytes !== undefined) {
    held.push({
      name: 'cases.readings',
      facts: [],
      tables: [
        {
          ...listed(
            { id: 'readings', label: 'Readings', hint: 'each reading a case made, newest first' },
            ['case', 'reading', 'count', 'stopped', 'regions', 'gone', 'values', 'added'],
            [...byCase()].flatMap(([id, list]) => list.map((reading, at) => [caseName(cases, id), at, ...counts(reading)])),
          ),
        },
        listed({ id: 'inputs', label: 'Inputs', hint: 'each file a reading stood on, and its digest' }, ['file', 'digest'], [...(readings()?.inputs ?? [])]),
      ],
    });
  }
  return {
    parts: held,
    ofCase: (id) => [
      ...JSON_PARTS.flatMap((name) => rowsAbout(name, parsed.get(name), id)),
      ...(byCase().get(id) ?? []).flatMap((reading, at) => readingTables(at, reading)),
    ],
  };
}

/** A case's name where the index holds it, and its id where it does not. */
function caseName(cases: Cases | undefined, id: string): string {
  const row = cases?.rowOf(id);
  return row === undefined || row < 0 ? id : cases!.nameAt(row);
}

function counts(reading: ReturnType<typeof decodeCase>[number]): Cell[] {
  return [reading.count, reading.stopped === undefined ? undefined : String(reading.stopped), reading.regions?.length, reading.gone?.length, reading.values?.length, reading.added?.length];
}

/** One reading's regions, then what it changed in the one after it. */
function readingTables(at: number, reading: ReturnType<typeof decodeCase>[number]): Table[] {
  const label = at === 0 ? 'Newest reading' : `Reading ${at}`;
  const region = (entry: NonNullable<typeof reading.regions>[number]): Cell[] => [entry[0], entry[1], entry[2], `${entry[3]}-${entry[4]}`, entry[5] ?? undefined];
  const names = ['module', 'name', 'path', 'lines', 'value'];
  return [
    ...(reading.regions === undefined ? [] : [listed({ id: `reading-${at}`, label, hint: 'the regions this reading crossed' }, names, reading.regions.map(region))]),
    ...(reading.gone === undefined ? [] : [listed({ id: `reading-${at}-gone`, label: `${label}, gone`, hint: 'positions in the reading it is read against' }, ['position'], reading.gone.map((position) => [position]))]),
    ...(reading.values === undefined ? [] : [listed({ id: `reading-${at}-values`, label: `${label}, values`, hint: 'positions whose value differs' }, ['position', 'value'], reading.values.map(([position, value]) => [position, value ?? undefined]))]),
    ...(reading.added === undefined ? [] : [listed({ id: `reading-${at}-added`, label: `${label}, added`, hint: 'regions it has that the other does not' }, ['position', ...names], reading.added.map(([position, entry]) => [position, ...region(entry)]))]),
  ];
}

function partOf(name: string, value: Json): Part {
  const facts: (readonly [string, Cell])[] = [];
  const tables: Table[] = [];
  const walk = (key: string, item: Json): void => {
    if (Array.isArray(item)) tables.push(arrayTable(name, key, item));
    else if (item !== null && typeof item === 'object') {
      const fields = Object.entries(item as Fields);
      if (fields.every(([, inner]) => inner === null || typeof inner !== 'object')) tables.push(listed({ id: `${name}-${key}`, label: key || name, hint: '' }, ['name', 'value'], fields.map(([at, inner]) => [at, scalar(inner)])));
      else for (const [at, inner] of fields) walk(key === '' ? at : `${key}.${at}`, inner);
    } else facts.push([key || name, scalar(item)]);
  };
  walk('', value);
  return { name, facts, tables };
}

/** An array of objects as a table, its columns the union of their keys; anything else as one column. */
function arrayTable(part: string, key: string, items: readonly Json[]): Table {
  const named = { id: `${part}-${key}`, label: key || part, hint: '' };
  const fields = [...new Set(items.flatMap((item) => (item !== null && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : [])))];
  if (fields.length === 0) return listed(named, ['value'], items.map((item) => [scalar(item)]));
  return listed(named, fields, items.map((item) => fields.map((field) => scalar((item as Fields | null)?.[field]))));
}

function scalar(value: Json | undefined): Cell {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** The rows of a part that name `id`, whole. */
function rowsAbout(name: string, value: Json | undefined, id: string): Table[] {
  if (value === undefined) return [];
  const found: Fields[] = [];
  const walk = (item: Json): void => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item !== null && typeof item === 'object') {
      const fields = item as Fields;
      if (fields['case'] === id || fields['id'] === id) found.push(fields);
      else Object.values(fields).forEach(walk);
    }
  };
  walk(value);
  return found.length === 0 ? [] : [{ ...arrayTable(name, 'about', found), id: `${name}-about`, label: name, hint: 'what this part says of this case' }];
}

