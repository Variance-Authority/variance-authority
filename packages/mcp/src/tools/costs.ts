import type { Tool } from './tool.js';

/**
 * `variance_costs` — which subjects, and which files, the suite spends its time on.
 *
 * A run times every subject from its first collection to its decision, and the
 * next run balances its shards on those times. The same numbers answer the
 * question an agent has before it narrows a run or splits a file: where does
 * the wall clock go. This is that answer, and nothing is computed here that the
 * run did not measure — a subject the run could not time is not in the list,
 * never listed at zero.
 *
 * Files come first because the file is what a shard places and what a person
 * edits: a slow subject in a file of fast ones is a subject, and a file of
 * forty moderate ones is the shard that finishes last. A subject whose
 * collector names no file is in the subject list and counted out of the file
 * list, by number.
 *
 * Its own subject rather than a report, because the costs a reader wants are
 * usually the mainline's — the whole suite, published by the last build — and
 * that is not a report anybody has open.
 */

/** One timed subject. */
export interface SubjectCost {
  readonly subject: string;
  /** Wall milliseconds, first collection to decision. */
  readonly ms: number;
  /** The file declaring it, where its collector names one. */
  readonly file?: string;
}

/** What each subject cost one run, and the sentence saying which run. */
export interface CostsSubject {
  /** Where these were read, as a reader should be told it: the line and commit, or the report. */
  readonly from: string;
  readonly subjects: readonly SubjectCost[];
}

const DEFAULT_LIMIT = 10;

export const costs: Tool<CostsSubject> = {
  name: 'variance_costs',
  description:
    'Where the suite spends its time: the files and subjects that took longest, from the times ' +
    'the last run recorded — the same times the next run balances its shards on. Read from the ' +
    'mainline’s published costs, so it covers the whole suite, or from the report you name. ' +
    'Ask this before narrowing a run, splitting a file of stories, or deciding which subjects a ' +
    'quick local loop can skip.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        description: `Optional. How many files and how many subjects to list; ${String(DEFAULT_LIMIT)} of each by default.`,
      },
    },
    additionalProperties: false,
  },

  run(subject, input) {
    const limit = limitOf(input['limit']);
    const timed = [...subject.subjects].sort(slowestFirstSubject);
    if (timed.length === 0) return `${subject.from} timed no subject.`;

    const total = timed.reduce((sum, entry) => sum + entry.ms, 0);
    const lines = [`${subject.from}: ${count(timed.length, 'subject')} timed, ${seconds(total)} in all.`];

    const files = filesOf(timed);
    const unfiled = timed.filter((entry) => entry.file === undefined).length;
    if (files.length > 0) {
      lines.push('', `Slowest files${unfiled === 0 ? '' : ` (${count(unfiled, 'subject')} ${unfiled === 1 ? 'names' : 'name'} no file)`}:`);
      const width = Math.max(...files.slice(0, limit).map((file) => seconds(file.ms).length));
      for (const file of files.slice(0, limit)) {
        lines.push(`  ${seconds(file.ms).padStart(width)}  ${file.file}  ${count(file.subjects, 'subject')}`);
      }
      if (files.length > limit) lines.push(`  and ${count(files.length - limit, 'more file')}`);
    }

    lines.push('', 'Slowest subjects:');
    const width = Math.max(...timed.slice(0, limit).map((entry) => seconds(entry.ms).length));
    for (const entry of timed.slice(0, limit)) {
      lines.push(`  ${seconds(entry.ms).padStart(width)}  ${entry.subject}${entry.file === undefined ? '' : `  ${entry.file}`}`);
    }
    if (timed.length > limit) lines.push(`  and ${count(timed.length - limit, 'more subject')}; \`--limit\` lists more`);
    return lines.join('\n');
  },
};

function limitOf(given: unknown): number {
  if (given === undefined) return DEFAULT_LIMIT;
  if (typeof given !== 'number' || !Number.isInteger(given) || given < 1) {
    throw new Error('`limit` must be a whole number of at least 1');
  }
  return given;
}

/** Longest first; a tie in code-unit order of the id, so the list is the same list twice. */
function slowestFirst<T extends { readonly ms: number }>(key: (entry: T) => string) {
  return (a: T, b: T): number => b.ms - a.ms || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

const slowestFirstSubject = slowestFirst<SubjectCost>((entry) => entry.subject);

interface FileCost {
  readonly file: string;
  readonly ms: number;
  readonly subjects: number;
}

function filesOf(timed: readonly SubjectCost[]): readonly FileCost[] {
  const files = new Map<string, { ms: number; subjects: number }>();
  for (const entry of timed) {
    if (entry.file === undefined) continue;
    const held = files.get(entry.file) ?? { ms: 0, subjects: 0 };
    held.ms += entry.ms;
    held.subjects += 1;
    files.set(entry.file, held);
  }
  return [...files].map(([file, held]) => ({ file, ...held })).sort(slowestFirst<FileCost>((entry) => entry.file));
}

function seconds(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}
