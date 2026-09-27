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
    'quick local loop can skip. `from` narrows it to the subjects declared at or under the paths you name.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        description: `Optional. How many files and how many subjects to list; ${String(DEFAULT_LIMIT)} of each by default.`,
      },
      from: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional. Paths from the repository root: only the subjects declared in these files, or in files under ' +
          'these directories. A subject whose collector names no file is outside every path.',
      },
    },
    additionalProperties: false,
  },

  run(subject, input) {
    const limit = limitOf(input['limit']);
    const paths = pathsOf(input['from']);
    const all = [...subject.subjects].sort(slowestFirstSubject);
    if (all.length === 0) return `${subject.from} timed no subject.`;
    const timed = paths === undefined ? all : all.filter((entry) => paths.some((path) => under(entry.file, path)));
    const where = paths === undefined ? '' : ` under ${paths.join(', ')}`;
    if (timed.length === 0) return nothingUnder(subject.from, where, all);

    const total = timed.reduce((sum, entry) => sum + entry.ms, 0);
    const outside = all.filter((entry) => entry.file === undefined).length;
    const share = paths === undefined
      ? ''
      : ` of the ${seconds(all.reduce((sum, entry) => sum + entry.ms, 0))} the run timed` +
        (outside === 0 ? '' : `; ${count(outside, 'subject')} ${outside === 1 ? 'names' : 'name'} no file and no path holds ${outside === 1 ? 'it' : 'them'}`);
    const lines = [`${subject.from}: ${count(timed.length, 'subject')} timed${where}, ${seconds(total)} in all${share}.`];

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

/** The paths asked about, spelled as the file field spells them; absent when none were. */
function pathsOf(given: unknown): readonly string[] | undefined {
  if (given === undefined) return undefined;
  if (!Array.isArray(given) || given.some((path) => typeof path !== 'string')) {
    throw new Error('`from` takes a list of paths from the repository root');
  }
  const paths = (given as string[]).map((path) => path.trim().replace(/^\.\//u, '').replace(/\/+$/u, '')).filter((path) => path !== '');
  if (paths.length === 0) throw new Error('`from` takes paths from the repository root, and none was given');
  return paths;
}

/** The file itself, or a file under the directory; `.` is the whole repository. */
function under(file: string | undefined, path: string): boolean {
  if (file === undefined) return false;
  return path === '.' || file === path || file.startsWith(`${path}/`);
}

/**
 * An empty scope, answered with where the time is instead: the directories two
 * segments deep that hold the most of it, so a mistyped or too-narrow path is
 * one step from a path that answers.
 */
function nothingUnder(from: string, where: string, all: readonly SubjectCost[]): string {
  const dirs = new Map<string, number>();
  for (const entry of all) {
    if (entry.file === undefined) continue;
    const dir = entry.file.split('/').slice(0, -1).slice(0, 2).join('/') || '.';
    dirs.set(dir, (dirs.get(dir) ?? 0) + entry.ms);
  }
  const heaviest = [...dirs].map(([dir, ms]) => ({ dir, ms })).sort(slowestFirst<{ dir: string; ms: number }>((entry) => entry.dir)).slice(0, 5);
  const hint = heaviest.length === 0
    ? ' No timed subject names a file, so no path can hold one.'
    : ` The timed subjects are declared under ${heaviest.map((entry) => `${entry.dir} (${seconds(entry.ms)})`).join(', ')}.`;
  return `${from} timed no subject${where}.${hint}`;
}

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
