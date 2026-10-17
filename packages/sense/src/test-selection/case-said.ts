/**
 * What a case said it arranged, as TypeScript holds it after capture: a string
 * the addon's `case_said.rs` wrote and alone reads. Joining, laying the
 * `tests.said` section, reading it back and resolving a row are its calls; here
 * is only how a resolved row is printed.
 */
import { native, nativeRefusal } from '../addon.js';
import type { NativeSaid } from '../native-said.js';

/**
 * Every item a case said, unresolved — overridden ones too — as
 * `[[name, value, site, level], …]` in the order the addon stores them.
 */
export type Said = string;

/** What a case that was listened to and said nothing said. */
export const SAID_NOTHING: Said = '[]';

/**
 * One precondition a case named: what it said, and the call that said it. Two
 * under one name on a row are a contradiction the case said.
 */
export interface CasePrecondition {
  readonly name: string;
  readonly value: string | number | boolean;
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
  if (held === undefined && said === undefined) return {};
  if (held === undefined || said === undefined) return { said: (held ?? said)! };
  return { said: saidJoined(undefined, [held, said])! };
}

/** A call site named from the checkout at `root`, as every row names it. */
export function saidSite(root: string, site: string): string {
  return addon('saidSite')(root, site);
}

/** The row a reader prints: per name, the values said at the narrowest level. */
export function saidRow(said: Said): readonly CasePrecondition[] {
  const row = JSON.parse(addon('saidResolved')(said)) as [string, string | number | boolean, string, number][];
  return row.map(([name, value, site, level]) => ({ name, value, site, level }));
}

/** A case's resolved row; undefined for a case nobody listened to. */
export function rowOf(test: { readonly said?: Said | undefined }): readonly CasePrecondition[] | undefined {
  return test.said === undefined ? undefined : saidRow(test.said);
}

/** The `tests.said` section for each case's said, laid into the crossing-set pool. */
export function saidLaid(
  said: readonly (Said | undefined)[],
  pool: { readonly bytes: Uint8Array; readonly offsets: Uint32Array },
  testCount: number,
): { readonly section?: Uint8Array; readonly bytes: Uint8Array; readonly offsets: Uint32Array } {
  const laid = addon('saidLaid')(
    said.map((one) => one ?? null),
    Buffer.from(pool.bytes.buffer, pool.bytes.byteOffset, pool.bytes.byteLength),
    pool.offsets,
    testCount,
  );
  return { ...(laid.section === null ? {} : { section: laid.section }), bytes: laid.bytes, offsets: laid.offsets };
}

/** What each case said, off a `tests.said` section and its pool; undefined for a case never listened to. */
export function saidRead(
  section: Uint8Array,
  pool: { readonly bytes: Uint8Array; readonly offsets: Uint32Array },
  testCount: number,
): readonly (Said | undefined)[] {
  const buffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return addon('saidRead')(buffer(section), buffer(pool.bytes), pool.offsets, testCount).map((one) => one ?? undefined);
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
    : `${name} contradicted: ${held.map((one) => `${String(one.value)} (${one.site})`).join(', ')}`,
  ).join(', ');
}

/** One thing a case said: `flag=ff-on`, or the bare name for `true`. */
export function valued(held: CasePrecondition): string {
  return held.value === true ? held.name : `${held.name}=${String(held.value)}`;
}
