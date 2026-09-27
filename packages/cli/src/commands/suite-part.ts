import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  withExamples,
  type ComponentInstance,
  type LexiconField,
  type LexiconValues,
  type SubjectComposition,
} from '@variance-authority/core/attribute';
import type { SuiteIndex } from '@variance-authority/report/suite-index';
import type { Config } from '../config.js';
import { costsLine } from './costs.js';
import { reportsAt, UNCOVERED } from './merge.js';
import { censusOf, examplesOf, lexiconReportFrom, type LexiconReading } from './compose.js';
import { isSlice, suitePartPath, type CliRunReport } from './run-report.js';
import { publishIndex, shareLines, suiteIndexPath } from './share.js';

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

export async function writeSuitePart(reportPath: string, part: SuitePart): Promise<void> {
  const path = suitePartPath(reportPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(part)}\n`);
}

/** The part beside a report, or nothing when there is none to read. */
export async function readSuitePart(reportPath: string): Promise<SuitePart | undefined> {
  let text: string;
  try {
    text = await readFile(suitePartPath(reportPath), 'utf8');
  } catch {
    return undefined;
  }
  const part = JSON.parse(text) as Partial<SuitePart>;
  if (part.version !== 1 || typeof part.planned !== 'number' || !Array.isArray(part.subjects)) {
    throw new Error(`${suitePartPath(reportPath)} is not a suite part this version reads`);
  }
  return part as SuitePart;
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

/** Which `k/n` are absent or repeated, when every part names one. */
function missingShards(parts: readonly SuitePart[]): string | undefined {
  const shards = parts.map((part) => part.shard);
  if (shards.some((shard) => shard === undefined)) return undefined;
  const totals = new Set(shards.map((shard) => shard!.total));
  if (totals.size > 1) return `the shards were cut ${[...totals].map((n) => `${String(n)} ways`).join(' and ')}`;
  const total = [...totals][0]!;
  const held = shards.map((shard) => shard!.index);
  const absent = Array.from({ length: total }, (_, i) => i + 1).filter((index) => !held.includes(index));
  if (absent.length > 0) return `shard ${absent.map((index) => `${String(index)}/${String(total)}`).join(', ')} is missing`;
  if (held.length > total) return `a shard of ${String(total)} was named twice`;
  return undefined;
}

/**
 * Where each component is declared, across shards.
 *
 * Every shard scanned the same source, and each laid over it what its own
 * engine located for the components it rendered. So a component's answer is
 * taken from a shard that rendered it, and from the first shard otherwise.
 */
function declaredOf(parts: readonly SuitePart[]): { readonly declaredIn?: Record<string, readonly string[]> } {
  if (parts.every((part) => part.declaredIn === undefined)) return {};
  const declaredIn: Record<string, readonly string[]> = {};
  const settled = new Set<string>();
  for (const part of parts) {
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

/**
 * `share --publish` over every shard's report: compose the index and publish it.
 *
 * `merged` is the reports already merged, which has refused shards of
 * different builds. What is refused here is what only the parts can show: a
 * shard that is missing, and one whose report has no part beside it.
 */
export async function publishComposed(
  config: Config,
  reports: readonly string[],
  merged: CliRunReport,
): Promise<readonly string[]> {
  const commit = merged.run?.commit;
  if (commit === undefined) return ['suite index: nothing published; these reports name no commit'];
  if (isSlice(merged) || (merged.notObserved ?? []).some((entry) => entry.because.startsWith(UNCOVERED))) {
    return ['suite index: nothing published; these reports do not cover the suite, so its census would be counted short'];
  }

  const parts: SuitePart[] = [];
  for (const path of reports) {
    const part = await readSuitePart(path);
    if (part === undefined) {
      return [`suite index: nothing published; ${path} has no ${suitePartPath(path)} beside it`];
    }
    parts.push(part);
  }

  const index = composeSuiteIndex(parts, commit);
  if (typeof index === 'string') return [`suite index: nothing published; ${index}`];
  if (index === undefined) return ['suite index: nothing published; no shard composed a subject'];

  const published = await publishIndex(config, { ...index, commit });
  return [
    `suite index at ${commit}, composed from ${String(parts.length)} shard(s): ${suiteIndexPath(config, commit)}`,
    ...(published.shared ? ['offered to the configured share'] : ['kept locally; no `share` is configured']),
  ];
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
  options: { readonly publish: boolean; readonly ref?: string; readonly reports: readonly string[] },
): Promise<readonly string[]> {
  const [only, ...more] = options.reports;
  if (!options.publish) return shareLines(config, { publish: false, ...(options.ref === undefined ? {} : { ref: options.ref }) });

  const merged = await reportsAt(options.reports, config.report);
  const lines = more.length === 0
    ? await shareLines(config, { publish: true, ...(only === undefined ? {} : { report: only }) })
    : await publishComposed(config, options.reports, merged);
  return [...lines, await costsLine(config, merged)];
}
