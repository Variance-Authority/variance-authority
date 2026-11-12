// compass: variance-authority.reach
/**
 * `variance share` in a repository whose root config declares its suites and
 * configures no visual project: every suite it gives to the share, or the one
 * `--suite` names, read from the mainline or published to it, with the records
 * a CI run's jobs handed on folded in first.
 *
 * A record is attributed to its suite by where the suite's run wrote it, the
 * path `cachedSuite` reads the suite from, which is what an uploaded
 * cache directory keeps. A file named beside `--suite` is that suite's whatever its
 * path. Nothing else is guessed: a file without that shape, or of a suite the
 * root config does not give to the share, is refused before anything is read.
 *
 * Each suite is read or published beside the others, and a refusal of one
 * keeps none of the rest from it: the command then exits `EXIT_OPERATOR` and
 * names every suite it refused, so a job that published two of three says
 * which one every pull request now measures from an older record of.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import type { ParsedShare } from '../share-args.js';
import { loadRenderless } from '../config-load.js';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, type ExitCode } from '../exit.js';
import { namedSuite } from './suite-record.js';
import { recordsFromQueue, type QueueRequest } from './from-queue.js';
import { headOf, suiteShare, type SuiteShare } from './suite-share.js';
import type { Here } from './share.js';

/** What `share` was asked in the root config's form. */
export interface SuitesShareOptions {
  /** The one suite; every suite given to the share when absent. */
  readonly suite?: string;
  readonly publish: boolean;
  /** Records to fold before the read or the publish: files, or directories holding `suites/<suite>/coverage.bin`. */
  readonly records: readonly string[];
  /** A file listing what the runner collects, or a directory holding one `<suite>.txt` per suite. */
  readonly collected?: string;
  /** The artifact names the merge queue's shards uploaded: their records are folded in place of `records`, as a run of part of the suite. */
  readonly fromQueue?: string;
  readonly format?: 'text' | 'github';
}

/**
 * `variance share` in the root config's form, or `undefined` when the project's
 * form answers: `--suite` is not named, and the config at `parsed.config`
 * configures a project, or the root config declares no suite to share.
 */
export async function runRootShare(
  parsed: ParsedShare,
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
  root: string = process.cwd(),
  here: Here = {},
): Promise<ExitCode | undefined> {
  const suite = parsed.suite ?? (await rootSuite(parsed.config, root));
  if (suite === null) return undefined;
  const done = await suitesShare(root, {
    ...(suite === undefined ? {} : { suite }),
    publish: parsed.publish,
    records: parsed.reports,
    ...(parsed.collected === undefined ? {} : { collected: parsed.collected }),
    ...(parsed.fromQueue === undefined ? {} : { fromQueue: parsed.fromQueue }),
    ...(parsed.format === undefined ? {} : { format: parsed.format }),
  }, here);
  if (done.lines.length > 0) streams.out(`${done.lines.join('\n')}\n`);
  if (done.notes !== undefined && done.notes.length > 0) streams.err(`${done.notes.join('\n')}\n`);
  return done.exit;
}

/**
 * Every suite asked for, read or published in code-unit order, and the suites
 * refused named last. Under `--format github` without `--suite`, a suite's
 * outputs are keyed by it, `commit-<suite>=`, as `carry` keys `against-<suite>=`.
 */
export async function suitesShare(
  root: string,
  options: SuitesShareOptions,
  here: Here = {},
  queue: (request: QueueRequest) => Promise<{ readonly dir: string } | { readonly none: string }> = recordsFromQueue,
): Promise<SuiteShare> {
  if (options.fromQueue === undefined) return sharedSuites(root, options, here);
  const commit = await headOf(root);
  const found = commit === undefined
    ? { none: 'this checkout has no commit' }
    : await queue({ root, pattern: options.fromQueue, commit, env: here.env ?? process.env });
  // The queue's record only comes ahead of the whole run's, so finding none leaves the mainline to that run.
  if ('none' in found) return { lines: [`nothing published from the merge queue: ${found.none}; the whole run at this commit publishes its record.`], exit: EXIT_CLEAN };
  try {
    return await sharedSuites(root, { ...options, records: [found.dir] }, here, true);
  } finally {
    await rm(found.dir, { recursive: true, force: true });
  }
}

async function sharedSuites(root: string, options: SuitesShareOptions, here: Here, partial = false): Promise<SuiteShare> {
  const selection = await import('@variance-authority/sense/test-selection');
  const shared = (selection.declaredSuites(root) ?? []).filter(({ carry }) => carry === 'share').map(({ name }) => name).sort();
  const suites = options.suite !== undefined ? [options.suite] : shared;
  if (suites.length === 0) throw new OperatorError('the root variance.config.json gives no suite to the share: name one with `"carry": "share"`');
  const records = options.records.length === 0 ? undefined : await recordsOf(root, options.records, options.suite, shared, selection.cachedSuite);
  const collected = options.collected === undefined ? undefined : await collectedOf(root, options.collected, suites);
  if (options.suite !== undefined) return suiteShare(root, suiteOptions(options.suite, options, records, collected, partial), here);

  const lines: string[] = [];
  const notes: string[] = [];
  const refused: string[] = [];
  const keyed = options.format === 'github';
  for (const suite of suites) {
    try {
      const done = await suiteShare(root, suiteOptions(suite, options, records, collected, partial), here);
      lines.push(...(keyed ? done.lines.map((line) => line.replace(/^([\w-]+)=/u, `$1-${suite}=`)) : done.lines));
      notes.push(...(done.notes ?? []));
      if (done.exit !== EXIT_CLEAN) refused.push(suite);
    } catch (error) {
      if (!(error instanceof OperatorError)) throw error;
      (keyed ? notes : lines).push(`${suite}: ${error.message}`);
      refused.push(suite);
    }
  }
  if (refused.length > 0) (keyed ? notes : lines).push(`${options.publish ? 'not published' : 'not read'}: ${refused.join(', ')}.`);
  return { lines, ...(keyed ? { notes } : {}), exit: refused.length > 0 ? EXIT_OPERATOR : EXIT_CLEAN };
}

function suiteOptions(
  suite: string,
  options: SuitesShareOptions,
  records: ReadonlyMap<string, readonly string[]> | undefined,
  collected: ReadonlyMap<string, string> | undefined,
  partial: boolean,
) {
  const listed = collected?.get(suite);
  return {
    suite,
    publish: options.publish,
    ...(partial ? { partial } : {}),
    ...(records === undefined ? {} : { records: records.get(suite) ?? [] }),
    ...(listed === undefined ? {} : { collected: listed }),
    ...(options.format === undefined ? {} : { format: options.format }),
  };
}

/**
 * The suite `share` without `--suite` means in the root config's form:
 * `undefined` for every suite given to the share, the only one declared when
 * none is, refused among several, and `null` when the project's form answers.
 */
async function rootSuite(config: string, root: string): Promise<string | undefined | null> {
  if ((await loadRenderless(config)) === undefined) return null;
  const selection = await import('@variance-authority/sense/test-selection');
  if ((selection.declaredSuites(root) ?? []).some(({ carry }) => carry === 'share')) return undefined;
  return (await namedSuite(root)).name ?? null;
}

/** Every record of a suite under `dir`, in code-unit order. */
async function recordsUnder(dir: string, of: (file: string) => string | undefined): Promise<string[]> {
  const found = await readdir(dir, { recursive: true });
  return found.map((path) => join(dir, path)).filter((path) => of(path) !== undefined).sort();
}

/**
 * The records given, by the suite each is of. With `suite` named every record
 * is that suite's: a file as it is, and a directory's `suites/<suite>/` alone.
 */
async function recordsOf(
  root: string,
  given: readonly string[],
  suite: string | undefined,
  shared: readonly string[],
  suiteOf: (file: string) => string | undefined,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const bySuite = new Map<string, string[]>();
  const add = (of: string, file: string) => bySuite.set(of, [...(bySuite.get(of) ?? []), file]);
  for (const path of given) {
    const at = resolve(root, path);
    const kind = await stat(at).catch(() => undefined);
    if (kind === undefined) throw new OperatorError(`the record ${path} is not there`);
    const files = kind.isDirectory() ? await recordsUnder(at, suiteOf) : [at];
    for (const file of files) {
      const of = suite ?? suiteOf(file);
      if (of === undefined) {
        throw new OperatorError(`${path} names no suite: a record is \`suites/<suite>/coverage.bin\` under a cache, or is named beside \`--suite\``);
      }
      if (suite !== undefined && kind.isDirectory() && suiteOf(file) !== suite) continue;
      if (suite === undefined && !shared.includes(of)) {
        throw new OperatorError(`${file} is a record of "${of}", which the root variance.config.json does not give to the share`);
      }
      add(of, file);
    }
  }
  return bySuite;
}

/** Each suite's list of what its runner collects: the file named, or `<suite>.txt` in the directory named. */
async function collectedOf(root: string, collected: string, suites: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const kind = await stat(resolve(root, collected)).catch(() => undefined);
  if (kind?.isDirectory() === true) return new Map(suites.map((suite) => [suite, join(collected, `${suite}.txt`)]));
  if (suites.length > 1) {
    throw new OperatorError(`\`--collected\` names the file ${collected}, and ${suites.length} suites are published; name a directory holding one \`<suite>.txt\` each`);
  }
  return new Map(suites.map((suite) => [suite, collected]));
}
