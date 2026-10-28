/**
 * What a case said it arranged and what the code read while it ran, as
 * TypeScript holds it after capture: a string the addon's `case_said.rs` wrote
 * and alone reads. Joining, laying the `tests.said`, `tests.read` and
 * `tests.misused` sections,
 * reading them back and resolving a row are its calls; here is only how a
 * resolved row is printed.
 */
import { native, nativeRefusal } from '../addon.js';
import preconditions from './case-preconditions.cjs';
import type { NativeSaid } from '../native-said.js';
import { codeUnitOrder } from '@variance-authority/core/segment';

/**
 * Every item a case said and read, unresolved — overridden ones too — as
 * `{"said": [[name, value, site, level], …], "read": […], "misused": […]}` in
 * the order the addon stores them. A facet is absent where nobody listened to
 * it; a misuse holds the argument that was wrong where an item holds its name.
 */
export type Said = string;

/** What a case that was listened to for preconditions alone, and said nothing, said. */
export const SAID_NOTHING: Said = '{"said":[]}';

/**
 * One item a case named: what it said, or what the code read in it, and the
 * call that did. Two said under one name on a row are a contradiction the case
 * said; two read under one name are two values the code read.
 */
export interface CasePrecondition {
  /** `dimension:key`. */
  readonly name: string;
  /** The value, as JSON gave it back; absent where JSON could not hold it: unrecorded. */
  readonly value?: unknown;
  /** The repository-relative `file:line` of the call. */
  readonly site: string;
  /**
   * Where it was said: how many describes deep the `beforeEach` that said it
   * was declared, `0` for one at the top of the file, and `65535` for the case
   * body. A narrower level overrides a wider one.
   */
  readonly level: number;
}

function addon<Entry extends keyof NativeSaid>(entry: Entry): NonNullable<NativeSaid[Entry]> {
  const loaded = native();
  const call = loaded?.[entry];
  if (loaded === undefined || call === undefined) {
    throw new Error(
      `what a case said requires the Sense native addon: ${nativeRefusal() ?? `the loaded addon has no \`${entry}\``}`,
    );
  }
  return call.bind(loaded) as NonNullable<NativeSaid[Entry]>;
}

/**
 * Every frame field or held said of one case, joined; undefined where none was
 * listened to. Each site is named from the checkout at `root` when given.
 */
export function saidJoined(root: string | undefined, said: readonly (Said | undefined)[]): Said | undefined {
  return addon('saidJoined')(root ?? null, said.map((one) => one ?? null)) ?? undefined;
}

/** What two frames, observations or runs of one case said, as one spread: `{}` where neither was listened to. */
export function saidAcross(held: Said | undefined, said: Said | undefined): { readonly said?: Said } {
  const joined = saidJoined(undefined, [held, said]);
  return joined === undefined ? {} : { said: joined };
}

/** A call site named from the checkout at `root`, as every row names it. */
export function saidSite(root: string, site: string): string {
  return addon('saidSite')(root, site);
}

/** A case's resolved row, facet by facet; a facet absent where nobody listened to it. */
export interface CaseRow {
  /** Per name, the values said at the narrowest level. */
  readonly said?: readonly CasePrecondition[];
  /** Per name and value read, the first site it was read at. */
  readonly read?: readonly CasePrecondition[];
  /**
   * Each `varianceBreadcrumb` call that made no `dimension:key`, once per
   * argument and value given, at the first site; absent where nobody listened
   * to reads.
   */
  readonly misused?: readonly Misuse[];
}

/** A `varianceBreadcrumb` call that made no `dimension:key`. */
export interface Misuse {
  /** The argument that was wrong: `dimension` or `key`. */
  readonly argument: 'dimension' | 'key';
  /** What it was given, as JSON gave it back; absent where JSON could not hold it. */
  readonly value?: unknown;
  /** The repository-relative `file:line` of the call. */
  readonly site: string;
  /** As {@link CasePrecondition.level}. */
  readonly level: number;
}

type Spelled = [name: string, value: string | null, site: string, level: number];

/** The row a reader prints: what the case said and what it read, each resolved, and each misused breadcrumb apart. */
export function saidRow(said: Said): CaseRow {
  const row = JSON.parse(addon('saidResolved')(said)) as { said?: Spelled[]; read?: Spelled[]; misused?: Spelled[] };
  const items = (spelled: Spelled[]) =>
    spelled.map(([name, value, site, level]): CasePrecondition =>
      value === null ? { name, site, level } : { name, value: JSON.parse(value) as unknown, site, level });
  return {
    ...(row.said === undefined ? {} : { said: items(row.said) }),
    ...(row.read === undefined ? {} : { read: items(row.read) }),
    ...(row.misused === undefined ? {} : {
      misused: items(row.misused).map(({ name, ...misuse }): Misuse => ({ argument: name as Misuse['argument'], ...misuse })),
    }),
  };
}

/** What a case heard as a machine reader is handed it: each facet resolved, and nothing where nobody listened to it. */
export interface CaseHeard {
  readonly preconditions?: readonly CasePrecondition[];
  readonly reads?: readonly CasePrecondition[];
  readonly misused?: readonly Misuse[];
}

/** A case's resolved row under the names `review` and `covering --format json` give it. */
export function caseHeard(test: { readonly said?: Said | undefined }): CaseHeard {
  if (test.said === undefined) return {};
  const row = saidRow(test.said);
  return {
    ...(row.said === undefined ? {} : { preconditions: row.said }),
    ...(row.read === undefined ? {} : { reads: row.read }),
    ...(row.misused === undefined ? {} : { misused: row.misused }),
  };
}

/** What a case said, resolved; undefined for a case nobody listened to for preconditions. */
export function rowOf(test: { readonly said?: Said | undefined }): readonly CasePrecondition[] | undefined {
  return test.said === undefined ? undefined : saidRow(test.said).said;
}

/** What the code read in a case, each key and value once; undefined where nobody listened to reads: unmeasured. */
export function readsOf(test: { readonly said?: Said | undefined }): readonly CasePrecondition[] | undefined {
  return test.said === undefined ? undefined : saidRow(test.said).read;
}

/** The `tests.said`, `tests.read` and `tests.misused` sections for what each case heard, laid into the crossing-set pool. */
export function saidLaid(
  said: readonly (Said | undefined)[],
  pool: { readonly bytes: Uint8Array; readonly offsets: Uint32Array },
  testCount: number,
): {
  readonly said?: Uint8Array;
  readonly read?: Uint8Array;
  readonly misused?: Uint8Array;
  readonly bytes: Uint8Array;
  readonly offsets: Uint32Array;
} {
  const laid = addon('saidLaid')(
    said.map((one) => one ?? null),
    Buffer.from(pool.bytes.buffer, pool.bytes.byteOffset, pool.bytes.byteLength),
    pool.offsets,
    testCount,
  );
  return {
    ...(laid.said === null ? {} : { said: laid.said }),
    ...(laid.read === null ? {} : { read: laid.read }),
    ...(laid.misused === null ? {} : { misused: laid.misused }),
    bytes: laid.bytes,
    offsets: laid.offsets,
  };
}

/**
 * What each case heard, off the `tests.said`, `tests.read` and `tests.misused`
 * sections, any absent, and their pool; undefined for a case never listened to.
 */
export function saidRead(
  sections: { readonly said?: Uint8Array; readonly read?: Uint8Array; readonly misused?: Uint8Array },
  pool: { readonly bytes: Uint8Array; readonly offsets: Uint32Array },
  testCount: number,
): readonly (Said | undefined)[] {
  const buffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const section = (bytes: Uint8Array | undefined) => (bytes === undefined ? null : buffer(bytes));
  return addon('saidRead')(
    section(sections.said),
    section(sections.read),
    section(sections.misused),
    buffer(pool.bytes),
    pool.offsets,
    testCount,
  )
    .map((one) => one ?? undefined);
}

/**
 * A resolved row as a reader prints it: `flag=ff-on (spec.ts:9)`, a bare `true`
 * as its name alone. A name said twice at one level is printed as the
 * contradiction it is, both values kept.
 */
export function preconditionText(said: readonly CasePrecondition[]): string {
  const byName = new Map<string, CasePrecondition[]>();
  for (const held of said) byName.set(held.name, [...byName.get(held.name) ?? [], held]);
  return [...byName].map(([name, held]) => held.length === 1
    ? `${valued(held[0]!)} (${held[0]!.site})`
    : `${name} contradicted: ${held.map((one) => `${valueText(one)} (${one.site})`).join(', ')}`,
  ).join(', ');
}

/** One thing a case said: `flags:new-checkout=ff-on`, or the bare name for `true`. */
export function valued(held: CasePrecondition): string {
  return held.value === true ? held.name : `${held.name}=${valueText(held)}`;
}

/** A value as a reader prints it: a string as itself, `unrecorded` where JSON could not hold it, JSON otherwise. */
export function valueText(held: CasePrecondition): string {
  if (!('value' in held)) return 'unrecorded';
  return typeof held.value === 'string' ? held.value : JSON.stringify(held.value);
}

/**
 * The values a case holds under `named`: every value it said, a contradiction's
 * both sides included, and nothing for a name it never said. `named` is a
 * `dimension:key`, or a bare dimension, which holds every key said under it.
 */
export function heldValues(said: readonly CasePrecondition[], named: string): readonly string[] {
  const under = named.includes(':') ? undefined : `${named}:`;
  return said.filter((held) => (under === undefined ? held.name === named : held.name.startsWith(under))).map(valueText);
}

/**
 * What a case heard, after its name: each key the code read as `read
 * flags:checkout=true said true`, or `said nothing`, then what the case said in
 * the dimensions the code never read, as spec 0093 prints it. A key said in a
 * dimension the code read, and never read itself, is left out. Where nobody
 * listened to reads or the code read nothing, what the case said alone;
 * nothing when it heard nothing. Each misused breadcrumb comes last, with its
 * site and what was wrong.
 */
export function heldText(test: { readonly said?: Said | undefined }): string {
  if (test.said === undefined) return '';
  const { said = [], read, misused = [] } = saidRow(test.said);
  const dimension = (name: string) => name.slice(0, name.indexOf(':'));
  const consulted = new Set(read?.map((held) => dimension(held.name)));
  const reads = read?.map((held) => {
    const values = said.filter((one) => one.name === held.name).map(valueText);
    return `read ${held.name}=${valueText(held)} said ${values.length === 0 ? 'nothing' : values.join(' and ')}`;
  });
  const unread = said.filter((held) => !consulted.has(dimension(held.name)));
  const parts = [
    // A case whose code read nothing prints nothing: in a codebase that leaves
    // no breadcrumb, that is every case. The record keeps it apart from absent.
    ...reads ?? [],
    ...unread.length === 0 ? [] : [preconditionText(unread)],
    ...misused.map((misuse) => `misused varianceBreadcrumb at ${misuse.site}: ${misuseWhy(misuse)}`),
  ];
  return parts.length === 0 ? '' : ` — ${parts.join(', ')}`;
}

/**
 * How the cases that entered one region split by what they heard: the
 * [`readSplit`](#readSplit) of their reads, then each misused breadcrumb with
 * how many of them met it, `misused varianceBreadcrumb at <site> by N: <why>`.
 */
export function heardSplit(cases: readonly CaseHeard[]): string {
  const misused = new Map<string, { misuse: Misuse; by: number }>();
  for (const one of cases) {
    for (const misuse of one.misused ?? []) {
      const key = JSON.stringify([misuse.argument, misuse.value, misuse.site]);
      const held = misused.get(key);
      if (held === undefined) misused.set(key, { misuse, by: 1 });
      else held.by += 1;
    }
  }
  return [
    readSplit(cases.map((one) => one.reads)),
    ...[...misused.values()].map(({ misuse, by }) => `misused varianceBreadcrumb at ${misuse.site} by ${by}: ${misuseWhy(misuse)}`),
  ].filter((part) => part !== '').join('; ');
}

/**
 * What was wrong with a misused breadcrumb, from the argument and the value it
 * was given: `the key 7 is not a string`, `the dimension is empty`, `the
 * dimension "flags:x" holds \`:\``.
 */
export function misuseWhy(misuse: Misuse): string {
  const { argument } = misuse;
  return preconditions.misuseWhy(argument, 'value' in misuse ? misuse.value : undefined) ?? `the ${argument} was misused`;
}

/**
 * How the cases that entered one region split by what the code read: each key
 * as `flags:checkout read false by 1, true by 2, not by 1`, the cases nobody
 * listened to for reads counted as unmeasured. A key read at one value by
 * every case is named too: which value reached the region is the reading.
 * Nothing is printed when no case was listened to or none read anything.
 */
export function readSplit(cases: readonly (readonly CasePrecondition[] | undefined)[]): string {
  const measured = cases.filter((read) => read !== undefined);
  if (measured.length === 0) return '';
  const unmeasured = cases.length - measured.length;
  const byName = new Map<string, Map<string, number>>();
  for (const read of measured) {
    for (const [name, values] of new Map(read.map((held) => [held.name, new Set(read.filter((one) => one.name === held.name).map(valueText))]))) {
      const counts = byName.get(name) ?? new Map<string, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      byName.set(name, counts);
    }
  }
  return [...byName]
    .map(([name, counts]) => {
      const reading = measured.filter((read) => read.some((held) => held.name === name)).length;
      return { name, counts, unread: measured.length - reading };
    })
    .sort((left, right) => codeUnitOrder(left.name, right.name))
    .map(({ name, counts, unread }) => [
      `${name} read ${[...counts].sort(([left], [right]) => codeUnitOrder(left, right)).map(([value, count]) => `${value} by ${count}`).join(', ')}`,
      ...unread === 0 ? [] : [`not by ${unread}`],
      ...unmeasured === 0 ? [] : [`unmeasured for ${unmeasured}`],
    ].join(', '))
    .join('; ');
}
