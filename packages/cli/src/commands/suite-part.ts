import { readFile } from 'node:fs/promises';
import {
  withExamples,
  type ComponentInstance,
  type LexiconField,
  type LexiconValues,
  type SubjectComposition,
} from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import type { SuiteIndex } from '@variance-authority/report/suite-index';
import type { Config } from '../config.js';
import { settle } from '../settle.js';
import { writeSuiteIndex } from '@variance-authority/report/file';
import { UNCOVERED } from './merge.js';
import { censusOf, examplesOf, lexiconReportFrom, type LexiconReading } from './compose.js';
import { reportsFor } from './report-read.js';
import { isSlice, suitePartPath, type CliRunReport } from './run-report.js';
import { describePublish, publishKept, shareLines, suiteIndexPath, type Here } from './share.js';

/**
 * One shard's share of the suite index, and the fold that makes the index whole.
 *
 * The index is a fact about a commit, and two of its answers are counted over
 * the whole suite: a component's `variants` and `renderings` are distinct
 * digests across every subject that renders it, and the lexicon keeps the
 * values the fewest subjects hold. A shard holds some of the subjects, so it
 * can write neither. It writes what they are counted from — each subject's
 * instances and its lexicon values before the cap — beside its report, and the
 * build that holds every shard's report composes the index one unsharded run
 * would have written, in plan order, and publishes it once.
 *
 * A build that runs unsharded writes no part and publishes its own index.
 */

/** What one shard read that the suite index is counted from. */
export interface SuitePart {
  readonly version: 1;
  readonly commit?: string;
  /** `--shard k/n`; absent on a slice cut by `--subjects`, which names no count. */
  readonly shard?: { readonly index: number; readonly total: number };
  /** Subjects in the plan every shard of the build planned alike. */
  readonly planned: number;
  /** The subjects this shard composed, by their position in that plan. */
  readonly subjects: readonly PartSubject[];
  /** Which lexicon fields this shard read. Absent when it composed no subject. */
  readonly fields?: readonly LexiconField[];
  readonly declaredIn?: Readonly<Record<string, readonly string[]>>;
}

interface PartSubject {
  readonly position: number;
  readonly subject: string;
  readonly instances: readonly ComponentInstance[];
  readonly lexicon: LexiconValues;
}

/**
 * The part a shard writes, from the plan-indexed compositions and the lexicon
 * it read over them. `reading.values` follows the non-null slots in order.
 */
export function suitePartOf(
  compositions: readonly (SubjectComposition | null)[],
  reading: LexiconReading | undefined,
  commit: string | undefined,
  shard?: { readonly index: number; readonly total: number },
): SuitePart {
  const subjects: PartSubject[] = [];
  let read = 0;
  compositions.forEach((composition, position) => {
    if (composition === null) return;
    const lexicon = reading?.values[read++];
    if (lexicon === undefined) return;
    subjects.push({ position, subject: composition.subject, instances: composition.instances, lexicon });
  });
  return {
    version: 1,
    ...(commit === undefined ? {} : { commit }),
    ...(shard === undefined ? {} : { shard: { index: shard.index, total: shard.total } }),
    planned: compositions.length,
    subjects,
    ...(reading === undefined ? {} : { fields: reading.fields }),
    ...(reading?.declaredIn === undefined ? {} : { declaredIn: reading.declaredIn }),
  };
}

/** A part as it is written: canonical, so equal parts are equal bytes. */
export function encodeSuitePart(part: SuitePart): Uint8Array {
  return new TextEncoder().encode(`${canonicalize(part as unknown as CanonicalValue)}\n`);
}

export async function writeSuitePart(reportPath: string, part: SuitePart): Promise<void> {
  await settle(suitePartPath(reportPath), encodeSuitePart(part));
}

/** The part beside a report, or nothing when there is none to read. */
export async function readSuitePart(reportPath: string): Promise<SuitePart | undefined> {
  const part = await openSuitePart(suitePartPath(reportPath));
  if (typeof part === 'string') throw new Error(part);
  return part;
}

/**
 * The part at `path`; nothing when no file is there; otherwise why it is not
 * `what` this version reads. Its shape is trusted past the version: the merge
 * checks what a part says against every other part before composing.
 */
export async function openSuitePart(path: string, what = 'a suite part'): Promise<SuitePart | string | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    return `${path} could not be read${code === undefined ? `: ${(error as Error).message}` : ` (${code})`}`;
  }
  let part: Partial<SuitePart>;
  try {
    part = JSON.parse(text) as Partial<SuitePart>;
  } catch {
    return `${path} is not JSON`;
  }
  const whole = part.version === 1 && typeof part.planned === 'number' && Array.isArray(part.subjects);
  return whole ? (part as SuitePart) : `${path} is not ${what} this version reads`;
}

/**
 * Every shard's part, composed into the index of the whole suite.
 *
 * A string when the parts are not one build's: plans of different lengths, or
 * one position claimed twice. `undefined` when no shard composed a subject,
 * the same answer an unsharded run with no snapshot gives.
 */
export function composeSuiteIndex(parts: readonly SuitePart[], commit: string): SuiteIndex | string | undefined {
  const missing = missingShards(parts);
  if (missing !== undefined) return missing;
  const planned = new Set(parts.map((part) => part.planned));
  if (planned.size > 1) return `the shards planned ${[...planned].join(' and ')} subjects; they are not one build`;

  const rows = parts.flatMap((part) => part.subjects).sort((left, right) => left.position - right.position);
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i]!.position === rows[i - 1]!.position) {
      return `${rows[i]!.subject} was composed by two shards; they are not one build`;
    }
  }
  if (rows.length === 0) return undefined;

  const present = rows.map(({ subject, instances }) => ({ subject, instances }));
  const census = censusOf(present);
  const examples = examplesOf(present);

  const fields = new Set(parts.flatMap((part) => part.fields ?? []));
  const lexicon = lexiconReportFrom({
    values: rows.map((row) => withExamples(row.lexicon, examples.get(row.subject) ?? [])),
    fields: [...fields],
    ...declaredOf(parts),
  });
  return { commit, subjects: census.subjects, components: census.components, lexicon };
}

/**
 * Whether the parts are one cut of one build: every shard of one count, each
 * once, or a single unsharded part. A `--subjects` slice names no shard either,
 * and is refused by its caller before it gets here.
 */
export function missingShards(parts: readonly SuitePart[]): string | undefined {
  const unsharded = parts.filter((part) => part.shard === undefined).length;
  const shards = parts.flatMap((part) => (part.shard === undefined ? [] : [part.shard]));
  if (unsharded > 1) return 'two unsharded parts were given; they are not one build';
  if (unsharded === 1 && shards.length > 0) {
    return `an unsharded part was given with shard ${String(shards[0]!.index)}/${String(shards[0]!.total)}; they are not one build`;
  }
  if (shards.length === 0) return undefined;
  const totals = new Set(shards.map((shard) => shard.total));
  if (totals.size > 1) return `the shards were cut ${[...totals].map((n) => `${String(n)} ways`).join(' and ')}`;
  const total = [...totals][0]!;
  const held = shards.map((shard) => shard.index);
  const absent = Array.from({ length: total }, (_, i) => i + 1).filter((index) => !held.includes(index));
  if (absent.length > 0) return `shard ${absent.map((index) => `${String(index)}/${String(total)}`).join(', ')} is missing`;
  const twice = held.find((index, i) => held.indexOf(index) !== i);
  if (twice !== undefined) return `shard ${String(twice)}/${String(total)} was given twice`;
  return undefined;
}

/**
 * Where each component is declared, across shards.
 *
 * Every shard scanned the same source, and each laid over it what its own
 * engine located for the components it rendered. So a component's answer is
 * taken from the lowest-numbered shard that rendered it, and from the
 * lowest-numbered shard otherwise — never from the order the parts were named
 * in, which is a shell glob's.
 */
function declaredOf(parts: readonly SuitePart[]): { readonly declaredIn?: Record<string, readonly string[]> } {
  if (parts.every((part) => part.declaredIn === undefined)) return {};
  const declaredIn: Record<string, readonly string[]> = {};
  const settled = new Set<string>();
  for (const part of [...parts].sort((left, right) => firstOf(left) - firstOf(right))) {
    const rendered = new Set(part.subjects.flatMap((row) => row.instances.map((instance) => instance.component)));
    for (const [component, files] of Object.entries(part.declaredIn ?? {})) {
      if (settled.has(component)) continue;
      if (rendered.has(component)) settled.add(component);
      if (rendered.has(component) || !(component in declaredIn)) declaredIn[component] = files;
    }
  }
  // In the order the first shard wrote them, which is the scan's, as a run
  // holding every subject would have.
  return { declaredIn };
}

/** Where a part sorts among its build's: its shard, or the first position it holds. */
function firstOf(part: SuitePart): number {
  return part.shard?.index ?? part.subjects[0]?.position ?? Number.MAX_SAFE_INTEGER;
}

/**
 * `share --publish` over every shard's report: compose the index, keep it, and
 * publish it with the merged report's costs.
 *
 * `merged` is the reports already merged, which has refused shards of
 * different builds. What is refused here is what only the parts can show: a
 * shard that is missing, and one whose report has no part beside it.
 */
export async function publishComposed(
  config: Config,
  reports: readonly string[],
  merged: CliRunReport,
  here: Here = {},
): Promise<readonly string[]> {
  const commit = merged.run?.commit;
  if (commit === undefined) return ['nothing published: these reports name no commit.'];
  if (isSlice(merged) || (merged.notObserved ?? []).some((entry) => entry.because.startsWith(UNCOVERED))) {
    return ['nothing published: these reports do not cover the suite, so its census would be counted short.'];
  }

  const parts: SuitePart[] = [];
  for (const path of reports) {
    const part = await readSuitePart(path);
    if (part === undefined) return [`nothing published: ${path} has no ${suitePartPath(path)} beside it.`];
    parts.push(part);
  }

  const index = composeSuiteIndex(parts, commit);
  if (typeof index === 'string') return [`nothing published: ${index}.`];
  if (index === undefined) return ['nothing published: no shard composed a subject.'];

  const path = suiteIndexPath(config, commit);
  try {
    await writeSuiteIndex(path, index);
  } catch {
    // A cache this machine could not write is a cache this machine does without.
  }
  const done = await publishKept(config, { commit, index }, { report: merged }, here);
  return [`suite index at ${commit}, composed from ${String(parts.length)} shard(s): ${path}`, ...describePublish(config, done)];
}

/**
 * `variance share`: a lookup, one report published, or every shard's.
 *
 * Several reports are one sharded build, and they publish the index composed
 * from all of their parts and the costs of the merged report. One report
 * publishes itself, as an unsharded build does from its own run.
 */
export async function shareOutput(
  config: Config,
  options: { readonly publish: boolean; readonly mainline?: string; readonly reports: readonly string[] },
  here: Here = {},
): Promise<readonly string[]> {
  const [only, ...more] = options.reports;
  if (!options.publish) {
    return shareLines(config, { publish: false, ...(options.mainline === undefined ? {} : { mainline: options.mainline }) }, here);
  }
  if (more.length === 0) return shareLines(config, { publish: true, ...(only === undefined ? {} : { report: only }) }, here);
  return publishComposed(config, options.reports, await reportsFor(options.reports, config), here);
}
