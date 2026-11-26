// compass: variance-authority.reach.crossings
/**
 * The record as it is stored: every section by name and size, and any one of
 * them as its values. What no other tab names is still shown here.
 */

import { columnBlob, columnBytes, columnWords, framedHeader, sectionsOf, type OpenedSections } from '@variance-authority/sense/record';
import { address, listed, type Detail, type Table } from './view-rows.js';

/** Every section of the record, those inside a framed part after it, each by its path. */
export interface Sections {
  readonly table: Table;
  detail(path: string): Detail | undefined;
}

interface Entry {
  readonly path: string;
  readonly name: string;
  readonly opened: OpenedSections;
  readonly bytes: number;
  readonly width: number;
  readonly rows: number | undefined;
}

export function openSections(bytes: Uint8Array): Sections {
  const entries: Entry[] = [];
  collect(sectionsOf(bytes), '', entries);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return {
    table: {
      id: 'record',
      label: 'Record',
      hint: `${bytes.length} bytes; a section inside another is named after it`,
      count: entries.length,
      columns: [
        { name: 'section', at: (row) => entries[row]!.path, link: (row) => address('section', entries[row]!.path) },
        { name: 'bytes', at: (row) => entries[row]!.bytes },
        { name: 'width', at: (row) => entries[row]!.width },
        { name: 'rows', at: (row) => entries[row]!.rows },
      ],
    },
    detail: (path) => {
      const entry = byPath.get(path);
      return entry === undefined ? undefined : { title: path, facts: [['bytes', entry.bytes], ['width', entry.width], ['rows', entry.rows]], tables: [valuesOf(entry)] };
    },
  };
}

function collect(opened: OpenedSections, prefix: string, into: Entry[]): void {
  for (const { name, length, width, rows } of opened.header.sections) {
    const path = `${prefix}${name}`;
    into.push({ path, name, opened, bytes: length, width, rows });
    if (width !== 1 || rows !== undefined) continue;
    const held = columnBytes(opened, name);
    if (framedHeader(held) !== undefined) collect(sectionsOf(held.slice()), `${path}/`, into);
  }
}

const HEX_ROW = 16;

function valuesOf({ name, opened, width }: Entry): Table {
  const named = { id: 'values', label: 'Values', hint: 'every row of the section as it is stored' };
  if (width === 4) {
    const words = columnWords(opened, name);
    return { ...named, count: words.length, columns: [{ name: 'row', at: (row) => row }, { name: 'value', at: (row) => words[row] }] };
  }
  const offsets = name.endsWith('.blob') ? `${name.slice(0, -'.blob'.length)}.off` : undefined;
  if (offsets !== undefined && opened.found.has(offsets)) {
    const bounds = columnWords(opened, offsets);
    const blob = columnBlob(opened, name, bounds);
    const texts = new TextDecoder();
    const at = (row: number) => blob.subarray(bounds[row]!, bounds[row + 1]!);
    const strings = name === 'strings.blob';
    return {
      ...named,
      count: Math.max(bounds.length - 1, 0),
      columns: [{ name: 'row', at: (row) => row }, { name: strings ? 'text' : 'bytes', at: (row) => (strings ? texts.decode(at(row)) : hex(at(row))) }],
    };
  }
  const bytes = columnBytes(opened, name);
  const lines = jsonLines(bytes);
  if (lines !== undefined) return listed(named, ['line', 'text'], lines.map((line, at) => [at + 1, line]));
  return {
    ...named,
    count: Math.ceil(bytes.length / HEX_ROW),
    columns: [
      { name: 'at', at: (row) => row * HEX_ROW },
      { name: 'bytes', at: (row) => hex(bytes.subarray(row * HEX_ROW, (row + 1) * HEX_ROW)) },
    ],
  };
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');

function jsonLines(bytes: Uint8Array): readonly string[] | undefined {
  if (bytes[0] !== 0x7b && bytes[0] !== 0x5b) return undefined;
  try {
    return JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), null, 2).split('\n');
  } catch {
    return undefined;
  }
}
