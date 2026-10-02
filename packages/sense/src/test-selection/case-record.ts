import { closeSync, openSync } from 'node:fs';
import { isMissing } from './instrumented-modules.js';
import { descriptor } from './coverage-file.js';
import { decodeRecordedEyes, readableEyes, type EyesSection } from './eyes-record.js';
import { invalid } from './format-validation.js';
import { DURATION, FORMAT, NAMES, sections, UNCASED_FORMAT, validSections, type Header, type Section, type Stored } from './format-layout.js';
import type { Bytes } from './columns.js';

/**
 * What a run recorded about its cases, carried inside the record its coverage
 * is: one file, so every rule that moves a record — landing, layering, seeding,
 * repinning, a share, a carried cache — moves the cases with it (spec 0094).
 *
 * Each part is one section holding its own self-describing bytes:
 *
 * - `cases` is the case index, in the set spelling `execution-set-format.ts`
 *   writes;
 * - `cases.before` is what the index held for the last run's files before it
 *   landed, the base an edit to a test is compared against;
 * - `cases.last` names that run, as JSON;
 * - `eyes` holds the Eyes journals of the cases that kept one, by case and
 *   attempt (`eyes-record.ts`).
 *
 * FIXME: `cases` and `cases.before` each carry a module and block table of
 * their own, re-encoding the files and blocks the record's coverage sections
 * already hold; spec 0094 lays the crossings onto the record's blocks instead.
 *
 * An absent part was not collected. A record with no case sections kept no
 * cases, or was written before a record carried them, and a reader answers
 * *unmeasured* for it, never *none*.
 */
export interface CaseSections {
  readonly index?: Uint8Array;
  readonly before?: Uint8Array;
  readonly last?: Uint8Array;
  readonly eyes?: Uint8Array;
}

const PARTS = { index: 'cases', before: 'cases.before', last: 'cases.last', eyes: 'eyes' } as const;
const ALL = Object.keys(PARTS) as readonly (keyof CaseSections)[];
const KNOWN: ReadonlySet<string> = new Set<string>([...NAMES, DURATION, ...Object.values(PARTS)]);

/**
 * The case sections of a record held in memory.
 *
 * Refuses a record holding a section this build does not know: every fold
 * reads the record it lays over through here, and a section it cannot name is
 * one it would drop.
 */
export function caseSectionsOf(record: Uint8Array): CaseSections {
  return partsOf(opened({ length: record.length, read: (from, to) => record.subarray(from, to) }));
}

/**
 * A record holding a section this build cannot name: a fold over it would drop
 * that section, so it refuses instead. Distinct from a record that does not
 * read at all, which a run records over.
 */
export class UnknownSection extends Error {
  constructor(readonly section: string) {
    super(`the record holds a section this build does not know, and would drop it: ${section}`);
  }
}

/**
 * The case sections a run lays its own over: none when the record at
 * `coverageFile` is missing or does not read, as `layeredCoverage` records over
 * such a record, and a refusal when it holds a section this build would drop.
 */
export function casesRecordedOver(coverageFile: string): CaseSections {
  try {
    return caseSectionsAt(coverageFile);
  } catch (error) {
    if (error instanceof UnknownSection) throw error;
    return {};
  }
}

/**
 * The case sections of the record at `coverageFile`, reading only them, and of
 * them only `parts`; none when there is no record.
 */
export function caseSectionsAt(coverageFile: string, parts: readonly (keyof CaseSections)[] = ALL): CaseSections {
  let fd: number;
  try {
    fd = openSync(coverageFile, 'r');
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
  try {
    return partsOf(opened(descriptor(fd)), parts);
  } finally {
    closeSync(fd);
  }
}

/** The case index the record at `coverageFile` carries, or `undefined` when it kept none. */
export async function caseIndexOf(coverageFile: string): Promise<Buffer | undefined> {
  const index = caseSectionsAt(coverageFile, ['index']).index;
  return index === undefined ? undefined : Buffer.from(index);
}

/** What the record at `coverageFile` holds of Eyes (`eyes-record.ts`); `undefined` when it kept none. */
export function recordedEyesAt(coverageFile: string): EyesSection | undefined {
  const { eyes } = caseSectionsAt(coverageFile, ['eyes']);
  return eyes === undefined ? undefined : decodeRecordedEyes(eyes);
}

/**
 * What the record held in `bytes` keeps of Eyes; `undefined` when it kept none,
 * as a case index on its own keeps none. A reader that also takes the index
 * reads both off the same bytes, so they are one run's even when a landing
 * replaces the file between two reads of it.
 */
export function recordedEyesOf(bytes: Uint8Array): EyesSection | undefined {
  if (peeked(bytes)?.sections.some((section) => section.name === PARTS.eyes) !== true) return undefined;
  const { eyes } = partsOf(opened({ length: bytes.length, read: (from, to) => bytes.subarray(from, to) }), ['eyes']);
  return decodeRecordedEyes(eyes!);
}

/**
 * The case index `bytes` hold: the `cases` section when they are a record that
 * carries one, and `bytes` themselves otherwise, which the index reader then
 * reads or refuses on its own terms. `native/src/journey_columns.rs` answers
 * the same question for the addon.
 */
export function recordedCases(bytes: Uint8Array): Uint8Array {
  const cases = peeked(bytes)?.sections.find((section) => section.name === PARTS.index && section.rows === undefined);
  if (cases === undefined) return bytes;
  const base = 4 + Buffer.from(bytes.buffer, bytes.byteOffset, 4).readUInt32LE(0);
  return bytes.subarray(base + cases.offset, base + cases.offset + cases.length);
}

/** Whether the record at `coverageFile` carries a case index, read off its header alone. */
export function keepsCases(coverageFile: string): boolean {
  return headerNames(coverageFile)?.includes(PARTS.index) === true;
}

/** The section names the record at `coverageFile` holds, read off its header alone. */
function headerNames(coverageFile: string): readonly string[] | undefined {
  let fd: number;
  try {
    fd = openSync(coverageFile, 'r');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  try {
    const file = descriptor(fd);
    const head = file.read(0, Math.min(file.length, 4));
    if (head.length < 4) return undefined;
    const length = Buffer.from(head.buffer, head.byteOffset, 4).readUInt32LE(0);
    if (length > file.length - 4) return undefined;
    const header = Buffer.concat([head, file.read(4, 4 + length)]);
    return peeked(header)?.sections.map((section) => section.name);
  } finally {
    closeSync(fd);
  }
}

function peeked(bytes: Uint8Array): { readonly sections: readonly Section[] } | undefined {
  if (bytes.length < 4 || bytes[0] === 0x7b) return undefined;
  const length = Buffer.from(bytes.buffer, bytes.byteOffset, 4).readUInt32LE(0);
  if (length === 0 || length > bytes.length - 4) return undefined;
  try {
    const text = Buffer.from(bytes.buffer, bytes.byteOffset + 4, length).toString('utf8').replace(/\0+$/u, '');
    const header = JSON.parse(text) as { sections?: unknown };
    return Array.isArray(header.sections) ? { sections: header.sections as Section[] } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `record` with its case sections replaced by `cases`.
 *
 * Every other section is carried as stored, packed or not, so a reader of the
 * coverage reads the same columns it did. A part `cases` leaves out is absent
 * from the result. A record of the layout before the case sections that is
 * given some is written as the current layout, which is the one that has them.
 */
export function withCaseSections(record: Uint8Array, cases: CaseSections): Buffer {
  const file = opened({ length: record.length, read: (from, to) => record.subarray(from, to) });
  const carried: Record<string, Stored> = {};
  for (const section of [...file.header.sections].sort((left, right) => left.offset - right.offset)) {
    if (isCasePart(section.name)) continue;
    const raw = Buffer.from(file.read(section));
    carried[section.name] =
      section.rows === undefined
        ? { plain: raw, rows: raw.length / section.width, width: section.width }
        : { plain: raw, rows: section.rows, packed: raw, width: section.width };
  }
  let cased = false;
  for (const [part, name] of Object.entries(PARTS) as [keyof CaseSections, string][]) {
    const bytes = cases[part];
    if (bytes === undefined) continue;
    carried[name] = { plain: Buffer.from(bytes), rows: bytes.length, width: 1 };
    cased = true;
  }
  const version = file.header.version as number;
  return sections(carried, cased && version === UNCASED_FORMAT ? FORMAT : version);
}

/**
 * `record` as another checkout takes it: the case index and its Eyes journals
 * kept, and the parts that name this checkout's last run dropped, because that
 * run is not the taker's. Every crossing — a seed, a fetch, a share — goes
 * through here.
 *
 * The journals cross because every crossing is one a person made: a seed is
 * the same machine's worktree, and a share or a carry names the Eyes section
 * among what it uploads before it does (spec 0094). A section this build
 * cannot read is dropped at the crossing, as an index that does not read is,
 * so no run over the taken record meets it.
 */
export function sharedRecord(record: Uint8Array): Uint8Array {
  const { index, before, last, eyes } = caseSectionsOf(record);
  const readable = eyes !== undefined && readableEyes(eyes) !== undefined;
  if (before === undefined && last === undefined && (eyes === undefined || readable)) return record;
  return withCaseSections(record, {
    ...(index === undefined ? {} : { index }),
    ...(readable ? { eyes } : {}),
  });
}

/** Whether the record at `coverageFile` carries Eyes journals, read off its header alone. */
export function keepsEyes(coverageFile: string): boolean {
  return headerNames(coverageFile)?.includes(PARTS.eyes) === true;
}

function isCasePart(name: string): boolean {
  return (Object.values(PARTS) as string[]).includes(name);
}

interface Opened {
  readonly header: Header;
  read(section: Section): Uint8Array;
}

function opened(file: Bytes): Opened {
  if (file.length < 4) throw invalid();
  const head = file.read(0, 4);
  const headerLength = Buffer.from(head.buffer, head.byteOffset, head.byteLength).readUInt32LE(0);
  if (headerLength > file.length - 4) throw invalid();
  const text = Buffer.from(file.read(4, 4 + headerLength)).toString('utf8').replace(/\0+$/u, '');
  const header = JSON.parse(text) as Header;
  const base = 4 + headerLength;
  if (!validSections(header.sections, file.length - base)) throw invalid();
  const unknown = header.sections.find((section) => !KNOWN.has(section.name));
  if (unknown !== undefined) {
    throw new UnknownSection(unknown.name);
  }
  return {
    header,
    read: (section) => file.read(base + section.offset, base + section.offset + section.length),
  };
}

function partsOf(file: Opened, wanted: readonly (keyof CaseSections)[] = ALL): CaseSections {
  const parts: { -readonly [part in keyof CaseSections]: Uint8Array } = {};
  for (const part of wanted) {
    const section = file.header.sections.find((candidate) => candidate.name === PARTS[part]);
    if (section !== undefined) parts[part] = file.read(section);
  }
  return parts;
}
