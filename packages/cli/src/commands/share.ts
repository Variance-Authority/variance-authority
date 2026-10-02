import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  findEntry,
  publishLine,
  readLine,
  type HeldEntry,
  type Published,
  type ShareEntry,
  type ShareLine,
  type ShareMiss,
} from '@variance-authority/core/share';
import type { RunReport } from '@variance-authority/report';
import { readSuiteIndex, writeSuiteIndex } from '@variance-authority/report/file';
import {
  decodeSuiteIndex,
  encodeSuiteIndex,
  suiteIndexOf,
  type SuiteIndex,
} from '@variance-authority/report/suite-index';
import type { Config } from '../config.js';
import { costsEntryOf } from './costs-entry.js';
import { REPORT_ENTRY, readSuiteEntry, reportEntryOf, suiteEntry, suiteEntryOf, type NamedImage } from '../share-entries.js';
import {
  descendsOf,
  distanceFrom,
  lineCellOf,
  lineOfRun,
  readerMainline,
  READ_REUSE_MS,
  type Env,
  type MainlinesMissing,
  type Unconfigured,
} from '../share-lines.js';
import { suiteIndexRoot } from './resources.js';
import { readCliRunReport } from './run.js';
import { isSlice, suitePartPath, type CliRunReport } from './run-report.js';

export { mainlinesOf, type Mainlines } from '../share-lines.js';

/**
 * Publishing a run to its line, and reading a mainline's suite index back — the
 * CLI half of ADR-0077.
 *
 * `@variance-authority/core/share` knows what a line holds and how a write
 * races another; `share-lines.ts` knows which line a run belongs to and which
 * one a reader reads; `share-entries.ts` knows what the report and a suite's
 * record look like as entries. This module puts the three together and says
 * what happened in prose.
 *
 * Nothing here can fail a run. A share that could not be reached, a line
 * nobody has written, an entry in a format this version does not read: each is
 * said, and the command exits clean. What is lost is time.
 */

/** The entry a suite index is published under. Carries its version. */
export const SUITE_INDEX_ENTRY = 'suite-index-v1';

/** Where this machine keeps the index for one commit of one project. */
export function suiteIndexPath(config: Pick<Config, 'project' | 'cacheRoot'>, commit: string): string {
  return join(suiteIndexRoot(config), config.project, `${commit}.bin`);
}

/**
 * Write this run's suite index on this machine, under the commit it names.
 *
 * Every run does this, share or no share: the index is what a later question
 * about this commit is answered from. A report with no commit writes nothing,
 * because an index addressed by a guess would be believed. Neither does one
 * shard's: its subjects are a slice, and the merge composes the index from
 * every shard's part.
 */
export async function keepSuiteIndex(
  config: Pick<Config, 'project' | 'cacheRoot'>,
  report: RunReport,
): Promise<{ readonly commit: string; readonly index: SuiteIndex } | undefined> {
  if (isSlice(report)) return undefined;
  const index = suiteIndexOf(report);
  if (index?.commit === undefined) return undefined;
  try {
    await writeSuiteIndex(suiteIndexPath(config, index.commit), index);
  } catch {
    // A cache this machine could not write is a cache this machine does without.
  }
  return { commit: index.commit, index };
}

/**
 * The line a run prints about its own index, empty when there is nothing to say.
 *
 * A run keeps its index and does not publish: publishing is `variance share
 * --publish`, which a workflow runs once after every job has written.
 */
export async function publishedLine(config: Config, report: RunReport, reportPath?: string): Promise<string> {
  if (isSlice(report) && reportPath !== undefined) {
    return `suite index: not kept from one shard; its part is ${suitePartPath(reportPath)}, for the merge\n`;
  }
  const kept = await keepSuiteIndex(config, report);
  return kept === undefined ? '' : `suite index: ${suiteIndexPath(config, kept.commit)}\n`;
}

/** Where a publish is run from. */
export interface Here {
  readonly env?: Env;
  readonly cwd?: string;
}

/**
 * What a publish did: the line it wrote and the core's account of it, or why it
 * wrote nothing.
 *
 * `noMainline` names the answers that were missing when no mainline is known,
 * which is why the line is a branch's. `leftOut` is present when the report was
 * written, and names each image the report names that this machine could not
 * read, as the absolute path it was looked for at. `unpublished` is present
 * when a suite's record here was not published, and says for each why.
 */
export type RunPublish =
  | ({
      readonly line: ShareLine;
      readonly published: Published;
      readonly leftOut?: readonly string[];
      readonly unpublished?: readonly string[];
    } & NoMainline)
  | ({ readonly line: ShareLine; readonly miss: MainlineMiss } & NoMainline)
  | { readonly none: string };

interface NoMainline {
  readonly noMainline?: MainlinesMissing;
}

/**
 * Publish this run's record to the line it belongs to.
 *
 * The suite index always, the subject costs when the run timed any, and the
 * report and each suite's record when the config gives them to the share to
 * carry. A mainline asks git whether a held entry is newer; a branch line never
 * does, because the latest push is the branch.
 */
export async function publishRun(config: Config, reportPath: string, here: Here = {}): Promise<RunPublish> {
  const report = await readCliRunReport(reportPath);
  if (isSlice(report)) {
    return {
      none: `${reportPath} is one shard of a build; name every shard's report to \`share --publish\` to publish the index composed from all of them`,
    };
  }
  const kept = await keepSuiteIndex(config, report);
  // FIXME: a report with no composition section (a raster-only capture,
  // ephemeral retention, a merged shard report) has no suite index, so this
  // publishes nothing, not report-v1 and not suite-v1, and says the report names
  // no commit when it may name one. docs/sharing.md states this boundary.
  if (kept === undefined) return { none: 'this report names no commit' };
  return publishKept(config, kept, { report, reportPath }, here);
}

/**
 * Publish an index already kept, with the record of the report it came from:
 * one run's, or the merge of every shard's, whose index was composed.
 *
 * `reportPath` is the file the report entry is read from, and a merged report
 * has none.
 */
export async function publishKept(
  config: Config,
  kept: { readonly commit: string; readonly index: SuiteIndex },
  from: { readonly report: CliRunReport; readonly reportPath?: string },
  here: Here = {},
): Promise<RunPublish> {
  const env = here.env ?? process.env;
  const cwd = here.cwd ?? process.cwd();
  const cell = await lineCellOf(config, { cwd });
  if (cell === undefined) return { none: 'no share is configured' };
  const run = await lineOfRun(config, env, cwd);
  if ('none' in run) return run;
  const noMainline = run.noMainline !== undefined ? { noMainline: run.noMainline } : {};
  if ('kind' in cell) return { line: run.line, miss: cell, ...noMainline };

  const at = { commit: kept.commit, ...(run.head !== undefined ? { head: run.head } : {}) };
  const entries: ShareEntry[] = [{ name: SUITE_INDEX_ENTRY, ...at, bytes: encodeSuiteIndex(kept.index) }];
  let images: readonly NamedImage[] = [];
  let leftOut: readonly string[] | undefined;
  // TODO: a sharded build publishes no report-v1; its report is one file per
  // shard, and its images sit beside each.
  if (config.reportCarry === 'share' && from.reportPath !== undefined) {
    const carried = await reportEntryOf(from.reportPath, at);
    entries.push(carried.entry);
    images = carried.images;
    leftOut = carried.leftOut;
  }
  const unpublished: string[] = [];
  // A report that timed nothing has no costs to give, the way a machine with no
  // record of a suite has no suite to give, and neither is news.
  const costs = await costsEntryOf(config, from.report, at);
  if (!('none' in costs)) entries.push(costs);
  for (const suite of config.suites ?? []) {
    if (suite.carry !== 'share') continue;
    const entry = await suiteEntryOf(cwd, suite.name, at, { whole: run.line.kind === 'mainline' });
    if (entry === undefined) continue;
    if ('unpublished' in entry) unpublished.push(`${suiteEntry(suite.name)}: ${entry.unpublished}`);
    else entries.push(entry);
  }

  const byDigest = new Map(images.map((image) => [image.digest, image.path]));
  const published = await publishLine(cell, run.line, entries, {
    descends: run.line.kind === 'mainline' ? await descendsOf(config, run.line.name, cwd) : async () => undefined,
    image: async (digest) => {
      const path = byDigest.get(digest);
      if (path === undefined) throw new Error(`no image on this machine has the digest ${digest}`);
      return new Uint8Array(await readFile(path));
    },
  });
  if ('kind' in published) return { line: run.line, miss: published, ...noMainline };
  return {
    line: run.line,
    published,
    // A report the line kept is not this run's, so what this run left out of it is not news.
    ...(leftOut !== undefined && published.written.includes(REPORT_ENTRY) ? { leftOut } : {}),
    ...(unpublished.length === 0 ? {} : { unpublished }),
    ...noMainline,
  };
}

/**
 * Why the reader's mainline did not answer: the share's own account, or that
 * nothing names a mainline, a share, or the credential the share was given.
 */
export type MainlineMiss = ShareMiss | Unconfigured;

/** Which mainline a read was about, and where its entry was derived. */
export interface MainlineAt {
  readonly mainline: string;
  readonly commit: string;
  /** Commits the entry is behind `HEAD`'s merge base with the mainline; negative when ahead. */
  readonly distance?: number;
}

/** A mainline's suite index, where it was read from, and how far it is from this checkout. */
export interface MainlineIndex extends MainlineAt {
  readonly from: 'local' | 'share';
  readonly index: SuiteIndex;
}

/**
 * Which mainline was asked and why it did not answer. `holds` names what the
 * line does hold when the miss is an entry it lacks, rather than the line.
 */
export interface MainlineMissed {
  readonly mainline?: string;
  readonly miss: MainlineMiss;
  readonly holds?: readonly string[];
}

/** A mainline index, or which mainline was asked and why it did not answer. */
export type MainlineRead = MainlineIndex | MainlineMissed;

/**
 * The suite index the reader's mainline holds.
 *
 * The line names the commit; this machine's copy at that commit is read before
 * the line's, because a commit's index is the same bytes wherever it is read.
 * What the line gives is kept, so the next command reads it from disk.
 */
export async function mainlineIndex(
  config: Config,
  options: Here & { readonly mainline?: string } = {},
): Promise<MainlineRead> {
  const found = await mainlineEntry(config, SUITE_INDEX_ENTRY, options);
  if ('miss' in found) return found;
  const { at, held } = found;
  // TODO: nothing compares this machine's index with the digest the manifest
  // names. Two runs at one commit that composed different subjects (a shard, a
  // filtered run) keep different indexes, and this one wins over the line's.
  const local = await readSuiteIndex(suiteIndexPath(config, at.commit)).catch(() => null);
  if (local !== null) return { ...at, from: 'local', index: local };

  const read = await held.bytes();
  if (!(read instanceof Uint8Array)) return { mainline: at.mainline, miss: read };
  let index: SuiteIndex;
  try {
    index = decodeSuiteIndex(read);
  } catch (error) {
    return { mainline: at.mainline, miss: { kind: 'unreadable', detail: (error as Error).message } };
  }
  try {
    await writeSuiteIndex(suiteIndexPath(config, at.commit), index);
  } catch {
    // A read-only cache directory costs one fetch per command and nothing else.
  }
  return { ...at, from: 'share', index };
}

/** One suite's record as the reader's mainline holds it: the coverage record, its cases inside it, and its runs record when the publisher carried it. */
export interface MainlineSuite extends MainlineAt {
  readonly coverage: Uint8Array;
  readonly runs?: Uint8Array;
}

/**
 * The record `suite` published to the reader's mainline, in the bytes the
 * suite's seam wrote.
 *
 * Nothing is kept on this machine: where a record is layered is the reader's
 * to say, and a copy written here would be a layer nobody asked for.
 */
export async function mainlineSuite(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  suite: string,
  options: Here & { readonly mainline?: string } = {},
): Promise<MainlineSuite | MainlineMissed> {
  const found = await mainlineEntry(config, suiteEntry(suite), options);
  if ('miss' in found) return found;
  const { at, held } = found;
  const read = await held.bytes();
  if (!(read instanceof Uint8Array)) return { mainline: at.mainline, miss: read };
  const parts = readSuiteEntry(read);
  if (typeof parts === 'string') return { mainline: at.mainline, miss: { kind: 'unreadable', detail: parts } };
  return { ...at, ...parts };
}

/**
 * Where the reader's mainline holds `name`, and a way to read its bytes.
 *
 * The mainline is the one named, or else the one `readerMainline` chooses. The
 * bytes are read only when asked, because a commit this machine already holds
 * is answered from disk.
 */
export async function mainlineEntry(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  name: string,
  options: Here & { readonly mainline?: string },
): Promise<{ readonly at: MainlineAt; readonly held: LineEntry } | MainlineMissed> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  let mainline = options.mainline;
  if (mainline === undefined) {
    const chosen = await readerMainline(config, env, cwd);
    if ('missing' in chosen) {
      return { miss: { kind: 'unconfigured', detail: `nothing answered from ${chosen.missing.join(', ')}` } };
    }
    mainline = chosen.name;
  }
  const found = await lineEntry(config, { kind: 'mainline', name: mainline }, name, cwd);
  if ('miss' in found) return { mainline, ...found };

  const distance = await distanceFrom(config, mainline, found.entry.commit, cwd);
  return { at: { mainline, commit: found.entry.commit, ...(distance !== undefined ? { distance } : {}) }, held: found };
}

/** One entry a line holds, and its bytes and images on demand. */
export interface LineEntry {
  readonly entry: HeldEntry;
  readonly bytes: () => Promise<Uint8Array | ShareMiss>;
  readonly image: (digest: string) => Promise<Uint8Array | ShareMiss>;
}

/**
 * Where `line` holds `name`, or why it does not.
 *
 * An `absent` entry on a line that exists carries what the line does hold, so
 * a reader can say *it holds suite-index-v1* rather than *nothing is
 * published*, which would send somebody to look for a publish that happened.
 */
export async function lineEntry(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  line: ShareLine,
  name: string,
  cwd: string,
): Promise<LineEntry | { readonly miss: MainlineMiss; readonly holds?: readonly string[] }> {
  const cell = await lineCellOf(config, { cwd, reuseMs: READ_REUSE_MS });
  if (cell === undefined) return { miss: { kind: 'unconfigured', detail: 'no share is configured' } };
  if ('kind' in cell) return { miss: cell };

  const held = await readLine(cell, line);
  if ('kind' in held) return { miss: held };
  const entry = findEntry(held.manifest, name);
  if ('kind' in entry) {
    return entry.kind === 'absent' ? { miss: entry, holds: held.manifest.entries.map((one) => one.name) } : { miss: entry };
  }
  return { entry, bytes: () => held.entry(entry), image: (digest) => held.image(digest) };
}

/**
 * `variance share` — what the reader's mainline holds, or what this run gave
 * its line.
 *
 * Always a clean exit. A share that holds nothing is a share the next push
 * fills, and failing a pipeline over it would make an optimisation
 * load-bearing.
 */
export async function shareLines(
  config: Config,
  options: { readonly publish: boolean; readonly mainline?: string; readonly report?: string },
  here: Here = {},
): Promise<readonly string[]> {
  if (options.publish) return describePublish(config, await publishRun(config, options.report ?? config.report, here));

  const found = await mainlineIndex(config, {
    ...here,
    ...(options.mainline !== undefined ? { mainline: options.mainline } : {}),
  });
  if ('miss' in found) {
    const line = found.mainline === undefined ? 'no mainline' : `mainline ${found.mainline}`;
    return [`${line}: ${describeMiss(found.miss, found.holds)}.`];
  }

  const lexicon = found.index.lexicon;
  return [
    `mainline ${found.mainline} evaluated at ${found.commit}, ${describeDistance(found.distance)}, read from ${found.from === 'local' ? 'this machine' : 'the share'}.`,
    `${found.index.subjects.length} subject(s), ${found.index.components.length} component(s)` +
      (lexicon === undefined
        ? ', no lexicon'
        : `, lexicon over ${lexicon.fields.length} field(s) of ${lexicon.subjects.length} subject(s)`),
    `at ${suiteIndexPath(config, found.commit)}`,
  ];
}

/** What a publish did, in the lines `variance share --publish` prints. */
export function describePublish(config: Pick<Config, 'share'>, done: RunPublish): readonly string[] {
  const where = describeShare(config);
  if ('none' in done) return [`nothing published: ${done.none}.`];
  const line = `${done.line.kind} ${done.line.name}`;
  // The reader's wording for the same absence, so both halves name it alike.
  const why =
    done.noMainline === undefined
      ? []
      : [`no mainline: nothing answered from ${done.noMainline.join(', ')}, so this run's line is ${line}.`];
  if ('miss' in done) return [`nothing published to ${line} in ${where}: ${describeMiss(done.miss)}.`, ...why];
  const { written, kept, unanswered } = done.published;
  const leftOut = done.leftOut ?? [];
  return [
    written.length === 0 ? `nothing written to ${line} in ${where}.` : `wrote ${written.join(', ')} to ${line} in ${where}.`,
    ...why,
    ...kept.map((held) =>
      held.because === 'newer-commit'
        ? `kept ${held.name}: the line holds it at ${held.commit}, which descends from this run's commit.`
        : `kept ${held.name}: the line holds it in a newer format, at ${held.commit}.`,
    ),
    ...(unanswered.length === 0
      ? []
      : [`replaced ${unanswered.join(', ')} without knowing whether the held commit was newer: git could not answer.`]),
    ...(leftOut.length === 0
      ? []
      : [
          `left out ${String(leftOut.length)} image(s) the report names and this machine could not read, the first at ${leftOut[0]!}.`,
        ]),
    ...(done.unpublished ?? []).map((why) => `left out ${why}.`),
  ];
}

function describeShare(config: Pick<Config, 'share'>): string {
  const share = config.share;
  if (share === undefined) return 'no share';
  if (share.kind === 'directory') return `the directory ${share.root}`;
  if (share.kind === 'http') return `the endpoint ${share.endpoint}`;
  return `${share.namespace ?? 'refs/variance'} on ${share.remote ?? 'origin'}`;
}

/** A miss in the words `variance share` prints it in, and what the line holds instead when it holds something. */
export function describeMiss(miss: MainlineMiss, holds?: readonly string[]): string {
  switch (miss.kind) {
    case 'absent':
      return holds === undefined || holds.length === 0 ? 'nothing is published there' : `it holds only ${holds.join(', ')}`;
    case 'newer':
      return `it holds ${miss.names.join(', ')}, a format this version does not read`;
    default:
      return miss.detail;
  }
}

/**
 * How far the record is from this checkout, in words.
 *
 * The one signal an operator has that publishing has stopped: a mainline
 * answering from forty commits back is a mainline nothing has pushed to since.
 */
export function describeDistance(distance: number | undefined): string {
  if (distance === undefined) return 'at a distance this clone cannot count';
  if (distance === 0) return 'at the merge base with this checkout';
  if (distance > 0) return `${String(distance)} commit(s) behind the merge base with this checkout`;
  return `${String(-distance)} commit(s) past the merge base with this checkout`;
}
