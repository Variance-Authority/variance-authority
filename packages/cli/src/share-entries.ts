/**
 * The report and a suite's record, as entries a share line holds.
 *
 * A line holds versioned entries, each derived at one commit, and images by
 * digest (ADR-0077). This file is the one place that says what `report-v1` and
 * `suite-v1/<suite>` contain, both ways, so the publisher and every reader
 * agree on it without a second spelling.
 *
 * - **`report-v1`** is the run report, byte for byte, and a table from each
 *   image path the report names to that image's digest. The report names its
 *   images relative to itself and the line keeps them by digest, so the table is
 *   what lets a reader on another machine open the picture a record points at.
 * - **`suite-v1/<suite>`** is the suite's coverage record, with the per-case
 *   index inside it when the run kept one, and its runs record when it has one.
 *   All name files repository-relative, so they read the
 *   same from any checkout. The module-name table is not in it: that table
 *   numbers the modules the *next* instrumented build emits, and a reader of a
 *   finished record never consults it.
 *
 * Neither entry holds the digest that keys a local cache layer, because that
 * digest is of one machine's absolute path.
 *
 * Both are framed the same way: one ASCII line of JSON naming each part and its
 * length, then the parts end to end. A reader takes the parts it knows by name,
 * so a part added later does not break it.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ShareEntry } from '@variance-authority/core/share';
import { askCoverageFile, commitRunsFile, keepsEyes, sharedRecord, testCoverageFile, type CommitRuns } from '@variance-authority/sense/test-selection';
import { readCliRunReport } from './commands/run-report.js';


/** The entry a run report is published under. */
export const REPORT_ENTRY = 'report-v1';

/** The entry one suite's record is published under. */
export function suiteEntry(suite: string): string {
  return `suite-v1/${suite}`;
}

/** Where an entry was derived: the commit CI ran on, and the head a pull request pointed at. */
export interface Derived {
  readonly commit: string;
  readonly head?: string;
}

/** An image a report entry names, and where its bytes are on this machine. */
export interface NamedImage {
  readonly digest: string;
  readonly path: string;
}

/**
 * The report at `reportPath` as a `report-v1` entry, the images it names, and
 * the ones it names that this machine could not read.
 *
 * An image the report names and the disk does not hold is left out of the
 * table rather than failing the publish: the report is still worth reading,
 * and a reader told nothing about a path says *not published* for it, which is
 * true. `leftOut` names each such image once, as the absolute path it was
 * looked for at, in the order the report names them, so the publish can say
 * what it did not carry.
 */
export async function reportEntryOf(
  reportPath: string,
  at: Derived,
): Promise<{ readonly entry: ShareEntry; readonly images: readonly NamedImage[]; readonly leftOut: readonly string[] }> {
  const bytes = await readFile(reportPath);
  const report = await readCliRunReport(reportPath);
  const table: Record<string, string> = {};
  const images = new Map<string, NamedImage>();
  const leftOut = new Map<string, string>();
  for (const observation of report.observations) {
    for (const named of Object.values(observation.images ?? {})) {
      if (named === undefined || named in table || leftOut.has(named)) continue;
      const path = resolve(dirname(reportPath), named);
      let held: Buffer;
      try {
        held = await readFile(path);
      } catch {
        leftOut.set(named, path);
        continue;
      }
      const digest = createHash('sha256').update(held).digest('hex');
      table[named] = digest;
      images.set(digest, { digest, path });
    }
  }
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const held = [...images.values()].sort((a, b) => (a.digest < b.digest ? -1 : 1));

  return {
    entry: {
      name: REPORT_ENTRY,
      ...at,
      ...(held.length === 0 ? {} : { images: held.map((image) => image.digest) }),
      bytes: frame([
        ['report.json', bytes],
        ['images.json', new TextEncoder().encode(JSON.stringify(sorted))],
      ]),
    },
    images: held,
    leftOut: [...leftOut.values()],
  };
}

/** A `report-v1` entry's parts: the report's bytes, and each image path's digest. */
export function readReportEntry(
  bytes: Uint8Array,
): { readonly report: Uint8Array; readonly images: Readonly<Record<string, string>> } | string {
  const parts = unframe(bytes);
  if (typeof parts === 'string') return parts;
  const report = parts.get('report.json');
  const images = parts.get('images.json');
  if (report === undefined || images === undefined) return 'a report-v1 entry holds report.json and images.json';
  let table: unknown;
  try {
    table = JSON.parse(new TextDecoder().decode(images));
  } catch {
    return 'the image table of a report-v1 entry is not JSON';
  }
  if (typeof table !== 'object' || table === null || Object.values(table).some((one) => typeof one !== 'string')) {
    return 'the image table of a report-v1 entry is not a map from path to digest';
  }

  return { report, images: table as Record<string, string> };
}

/**
 * One suite's record as a `suite-v1/<suite>` entry; undefined when the suite
 * has recorded nothing here, which is not an empty record; or why the record
 * here is not published.
 *
 * A record is published only under the commit it names. Its regions are line
 * coordinates in that commit's text, so a record an earlier run left here,
 * published under this run's commit, would place every region in the wrong
 * text. The base reader refuses such a record by the same test; refusing it
 * here keeps the bytes off the line.
 *
 * The runs record the suite's runs wrote beside it travels with it, as
 * `coverage.runs.json`, because it is the only thing that says where each test
 * in the record last ran, and once the record leaves this machine nothing else
 * can. `whole` is set for a mainline, whose record every checkout measures from:
 * then the record is published only when its runs record shows a run of the
 * whole suite at this commit, which {@link wholeRunAt} tells from the runs record
 * and from what the runner collects (`collected`), never from the caller's
 * word. Without `collected` it cannot be told, and the record is left out.
 */
export async function suiteEntryOf(
  root: string,
  suite: string,
  at: Derived,
  options: { readonly whole?: boolean; readonly collected?: ReadonlySet<string> } = {},
): Promise<ShareEntry | { readonly unpublished: string } | undefined> {
  const coverage = testCoverageFile(root, { suite });
  const record = await held(coverage);
  if (record === undefined) return undefined;
  let recorded: string | undefined;
  try {
    recorded = askCoverageFile(coverage, (view) => view.commit);
  } catch (error) {
    return { unpublished: `its record at ${coverage} does not read: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (recorded === undefined) return { unpublished: `its record at ${coverage} names no commit` };
  if (recorded !== at.commit) return { unpublished: `its record at ${coverage} was recorded at ${recorded}, not at ${at.commit}` };
  const runs = await held(commitRunsFile(coverage));
  if (options.whole === true) {
    const partial = wholeRunAt(runs, at.commit, options.collected);
    if (partial !== undefined) return { unpublished: `its record at ${coverage} is not a whole run: ${partial}` };
  }

  return {
    name: suiteEntry(suite),
    ...at,
    bytes: frame([
      // The cases travel in the record; what names this checkout's last run does not.
      ['coverage.bin', sharedRecord(record)],
      ...(runs === undefined ? [] : [[RUNS_PART, runs] as const]),
    ]),
  };
}

/**
 * Whether `suite`'s record here carries its cases' Eyes journals.
 *
 * A share of the record uploads them with it, so whoever publishes is told:
 * opting into Eyes kept the journals on this machine, and the share is the step
 * that takes them off it.
 */
export function suiteKeepsEyes(root: string, suite: string): boolean {
  return keepsEyes(testCoverageFile(root, { suite }));
}

/** The part of a `suite-v1` entry that holds the runs record, named as it lies beside the record. */
const RUNS_PART = 'coverage.runs.json';

/**
 * Why the runs record `runs` does not show a run of the whole suite at
 * `commit`, or `undefined` when it does.
 *
 * Whole means every test the record holds either ran at `commit` or is a test
 * file the suite no longer collects there. The runs record lists the tests that
 * ran at its commit and, under `standing`, where every other test last ran; a
 * record without `standing` does not know, and is not taken as whole. A test
 * file the suite stopped collecting stays in the record, because its cases are
 * what the base had, so a test standing at an older commit counts against the
 * run only while the suite still collects it.
 *
 * The runner owns what the suite collects, so `collected` is its answer: the
 * repository-relative test files it lists at `commit`, each of which the runs
 * record must list as run or standing somewhere. Without it nothing here can
 * say which files are tests the suite still runs, since the checkout holds
 * tests and every other file alike, so an unknown collection is not whole, and
 * the refusal says to pass it.
 */
export function wholeRunAt(
  runs: Uint8Array | undefined,
  commit: string,
  collected?: ReadonlySet<string>,
): string | undefined {
  if (runs === undefined) return 'no runs record lies beside it, so nothing says which tests ran at this commit';
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(runs));
  } catch {
    return 'the runs record beside it is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'the runs record beside it is not a JSON object';
  const parsed = value as CommitRuns;
  if (parsed.commit !== commit) return `the runs record beside it is ${parsed.commit ?? 'of no commit'}'s, not ${commit}'s`;
  // The record is JSON a run wrote, read here without its writer's types: a
  // shape it does not have is refused by name, never met as a TypeError.
  if (!Array.isArray(parsed.files)) return 'the runs record beside it has no list of the test files that ran at its commit';
  if (parsed.standing === undefined) return 'the runs record beside it does not say where every test it did not run last ran';
  if (!Array.isArray(parsed.standing)) return 'the runs record beside it holds a `standing` that is not a list';
  if (!parsed.standing.every((entry: unknown) => typeof entry === 'object' && entry !== null && Array.isArray((entry as { files?: unknown }).files))) {
    return 'the runs record beside it holds a `standing` entry with no list of test files';
  }
  if (collected === undefined) {
    return 'the runner was not asked which test files it collects, so nothing says the run covered all of them: pass `--collected`';
  }
  const listed = new Set([...parsed.files, ...parsed.standing.flatMap((entry) => entry.files)]);
  const unlisted = [...collected].filter((path) => !listed.has(path)).sort();
  if (unlisted.length > 0) {
    const named = unlisted.length > 5 ? `${unlisted.slice(0, 5).join(', ')} and ${unlisted.length - 5} more` : unlisted.join(', ');
    return `${unlisted.length} test file(s) the suite collects are listed nowhere in the runs record: ${named}`;
  }
  // A test standing at this commit ran at it, in a run before the latest.
  const kept = parsed.standing
    .filter((entry) => entry.commit !== commit)
    .flatMap((entry) => entry.files)
    .filter((path) => collected.has(path));
  if (kept.length === 0) return undefined;
  return `${kept.length} test file(s) the suite collects last ran before ${commit}, ${kept[0]} among them`;
}

/**
 * A `suite-v1` entry's parts: the coverage record, its cases inside it when the
 * publishing run kept them, and the runs record when the publisher carried it.
 * A per-case index framed beside the record by an earlier publisher is not
 * read: that record reads as one that kept no cases.
 */
export function readSuiteEntry(
  bytes: Uint8Array,
): { readonly coverage: Uint8Array; readonly runs?: Uint8Array } | string {
  const parts = unframe(bytes);
  if (typeof parts === 'string') return parts;
  const coverage = parts.get('coverage.bin');
  if (coverage === undefined) return 'a suite-v1 entry holds coverage.bin';
  const runs = parts.get(RUNS_PART);

  return { coverage, ...(runs === undefined ? {} : { runs }) };
}

async function held(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Parts end to end, after one ASCII line naming each and its length. */
export function frame(parts: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const header = new TextEncoder().encode(`${JSON.stringify(parts.map(([name, bytes]) => [name, bytes.byteLength]))}\n`);
  const out = new Uint8Array(header.byteLength + parts.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0));
  out.set(header, 0);
  let at = header.byteLength;
  for (const [, bytes] of parts) {
    out.set(bytes, at);
    at += bytes.byteLength;
  }

  return out;
}

/** The parts {@link frame} wrote, by name, or why the bytes are not a frame. */
export function unframe(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> | string {
  const end = bytes.indexOf(0x0a);
  if (end < 0) return 'the entry has no header line';
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(0, end)));
  } catch {
    return 'the entry header is not JSON';
  }
  if (!Array.isArray(header)) return 'the entry header is not a list of parts';
  const parts = new Map<string, Uint8Array>();
  let at = end + 1;
  for (const part of header as unknown[]) {
    if (!Array.isArray(part) || typeof part[0] !== 'string' || !Number.isInteger(part[1]) || (part[1] as number) < 0) {
      return 'the entry header names a part without a name and a length';
    }
    const size = part[1] as number;
    if (at + size > bytes.byteLength) return `the entry is shorter than its header says, at ${part[0]}`;
    // A copy, not a view: a part's offset in the entry moves with the header's
    // length, and a reader that lays typed arrays over a part, as the per-case
    // index does, needs it to start at offset 0 of its own buffer.
    parts.set(part[0], bytes.slice(at, at + size));
    at += size;
  }
  if (at !== bytes.byteLength) return 'the entry is longer than its header says';

  return parts;
}
