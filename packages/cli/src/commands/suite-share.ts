// compass: variance-authority.reach
/**
 * `variance share --suite <name>`: one suite's record to its line, and back,
 * for a repository whose root config declares its suites and configures no
 * visual project.
 *
 * `share --publish` publishes a run report's entries, so it needs a project
 * config and a report that names a commit. A repository that runs only a unit
 * suite has neither, and its record is still the base every checkout of it
 * wants. This publishes only `suite-v1/<suite>`, read from the root config's
 * `share` section the way `select` and `review` read it back, and asks the same
 * owners every publish asks: `lineOfRun` for the line, git for descent, and
 * `suiteEntryOf` for whether the record here was recorded at this commit and,
 * for a mainline, whether its runs record shows a run of the whole suite there.
 *
 * A mainline publish that writes nothing fails the command. Every checkout and
 * every pull request measures from the record this publish leaves, so a
 * refusal on the mainline leaves each of them on an older base, and a job that
 * passes over it says nothing to the one person who could fix it. A run on a
 * branch line, or on no line, publishes nothing that anyone measures from, and
 * stays clean.
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { publishLine } from '@variance-authority/core/share';
import { instrumentationId } from '@variance-authority/sense/instrument';
import type { DeclaredSuite } from '@variance-authority/sense/test-selection';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, type ExitCode } from '../exit.js';
import { entryCarriesEyes, suiteEntry, suiteEntryOf } from '../share-entries.js';
import { descendsOf, lineCellOf, lineOfRun } from '../share-lines.js';
import { landSuite } from './journeys-command.js';
import { mainlineBase, mainlineMissed, mainlineRead, type MainlineBase } from './mainline-base.js';
import { recordHeld, rootShare } from './mainline-selected.js';
import { layMainline, mainlinePassedOver } from './suite-base.js';
import { describePublish, eyesWritten, unkept, type Here, type RunPublish } from './share.js';

/** What `share --suite` was asked to do. */
export interface SuiteShareOptions {
  readonly suite: string;
  readonly publish: boolean;
  /**
   * A file listing the test files the suite's runner collects, one per line,
   * relative to `root` or absolute: what a mainline publish counts a whole run
   * against. A line naming no test in the record changes nothing.
   */
  readonly collected?: string;
  /** The records are a run of part of the suite, such as the merge queue's: a mainline publishes them marked so. */
  readonly partial?: boolean;
  /**
   * `github` prints the read as `commit=<sha>` for `$GITHUB_OUTPUT`, empty when
   * the mainline holds no record, and says the read beside it: the commit a
   * workflow merges a pull request with, so the change a selection measures is
   * the pull request's alone.
   */
  readonly format?: 'text' | 'github';
  /**
   * Records this suite's jobs handed on, folded over the base before the read
   * is told or the publish writes: a sharded or sliced run made one again.
   */
  readonly records?: readonly string[];
}

/**
 * Publish this checkout's record of `suite` to the line this run belongs to,
 * at `HEAD`, or say why nothing was written.
 *
 * `HEAD` is the commit the run is at, and the record names the commit it was
 * recorded at; `suiteEntryOf` refuses a record whose commit is not `HEAD`'s,
 * so a record an earlier run left behind is never published as this one's.
 */
export async function publishSuite(
  root: string,
  suite: string,
  here: Here = {},
  options: Pick<SuiteShareOptions, 'collected' | 'partial'> = {},
): Promise<RunPublish> {
  return (await publishOnLine(root, suite, here, options)).done;
}

/** The publish, and whether the line it was for is a mainline, which a refusal is not allowed to pass over. */
async function publishOnLine(
  root: string,
  suite: string,
  here: Here,
  options: Pick<SuiteShareOptions, 'collected' | 'partial'>,
): Promise<{ readonly done: RunPublish; readonly mainline: boolean }> {
  const env = here.env ?? process.env;
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = declaredIn(selection.declaredSuites(root), suite);
  const off = (done: RunPublish) => ({ done, mainline: false });
  if (declared.carry !== 'share') {
    return off({ none: `the suite "${suite}" is not given to the share; its "carry" in the root config is not "share"` });
  }
  const share = rootShare(selection.rootConfig(root));
  const place = { ...(share === undefined ? {} : { share }), cacheRoot: selection.cacheRootFor(root) };
  const cell = await lineCellOf(place, { cwd: root });
  if (cell === undefined) return off({ none: 'no share is configured' });
  const run = await lineOfRun(place, env, root);
  if ('none' in run) return off(run);
  const on = (done: RunPublish) => ({ done, mainline: run.line.kind === 'mainline' });
  const noMainline = run.noMainline !== undefined ? { noMainline: run.noMainline } : {};
  if ('kind' in cell) return on({ line: run.line, miss: cell, ...noMainline });

  const commit = await headOf(root);
  if (commit === undefined) return on({ none: 'this checkout has no commit' });
  const at = { commit, ...(run.head !== undefined ? { head: run.head } : {}) };
  const collected = options.collected === undefined ? undefined : await collectedIn(root, options.collected);
  const entry = await suiteEntryOf(root, suite, at, {
    whole: run.line.kind === 'mainline',
    ...(collected === undefined ? {} : { collected }),
    ...(options.partial === true ? { partial: true } : {}),
  });
  if (entry === undefined) return on({ none: `this checkout holds no record of "${suite}"` });
  if ('unpublished' in entry) return on({ none: `${suiteEntry(suite)} is left out: ${entry.unpublished}` });

  const { retired, ...shared } = entry;
  const published = await publishLine(cell, run.line, [shared], {
    descends: run.line.kind === 'mainline' ? await descendsOf(place, run.line.name, root) : async () => undefined,
    // A suite entry names no image.
    image: async (digest) => {
      throw new Error(`a suite record names no image, and was asked for ${digest}`);
    },
  });
  if ('kind' in published) return on({ line: run.line, miss: published, ...noMainline });
  const eyes = entryCarriesEyes(entry) ? eyesWritten([entry.name], published.written) : {};
  const gone = retired === undefined ? {} : { retired: { [entry.name]: retired } };
  return on({ line: run.line, published, ...eyes, ...gone, ...noMainline });
}

/** What `share` prints for one suite, and the code it exits with. `notes` are said beside `lines` when `lines` are a workflow's output. */
export interface SuiteShare {
  readonly lines: readonly string[];
  readonly notes?: readonly string[];
  readonly exit: ExitCode;
}

/**
 * What `variance share --suite <name>` prints, and the code it exits with:
 * what the publish did, or the record the reader's mainline holds and where it
 * is kept. A mainline publish that wrote nothing exits `EXIT_OPERATOR`.
 *
 * The read lays the mainline's record into this checkout's own layer, where
 * the run it makes next lands on it, and says when the suite has no base to
 * run from. `records`, when given, are folded over that base, as `variance
 * journeys --suite` lands shards, before the read is told or the publish
 * writes; a publish given none publishes the record this checkout holds.
 */
export async function suiteShare(root: string, options: SuiteShareOptions, here: Here = {}): Promise<SuiteShare> {
  const selection = await import('@variance-authority/sense/test-selection');
  if (options.publish) {
    const based = options.records === undefined ? undefined : await baseAndFold(root, options.suite, options.records, here);
    const folded = based === undefined ? [] : [based.said, ...based.notices, ...based.landed];
    const share = rootShare(selection.rootConfig(root));
    const { done, mainline } = await publishOnLine(root, options.suite, here, options);
    const lines = [...folded, ...describePublish(share === undefined ? {} : { share }, done)];
    return { lines, exit: (mainline && !('published' in done)) || unkept(done) ? EXIT_OPERATOR : EXIT_CLEAN };
  }
  const { read, said, notices, landed } = await baseAndFold(root, options.suite, options.records, here);
  if (options.format !== 'github') return { lines: [said, ...notices, ...landed], exit: EXIT_CLEAN };
  const commit = read === undefined || 'miss' in read ? '' : read.commit;
  const based = selection.keepsCases(selection.testCoverageFile(root, { suite: options.suite })) ? ['based=true'] : [];
  const notes = [said, ...notices.map((line) => `::notice::${line}`), ...landed];
  return { lines: [`commit=${commit}`, ...based], notes, exit: EXIT_CLEAN };
}

/**
 * The mainline's record of `suite`, laid into this checkout's own layer when
 * it was read, and `records` folded over the layer: what was read, what it
 * leaves the suite without, and what the fold landed. A suite's one record
 * that its job laid over a base is put in place instead (`laidAsLeft`).
 *
 * A read this run already handed on, as `carry receive` lays one, stands
 * without asking the line again; any other is asked now, whatever was fetched
 * a moment ago. A record written under other probes than this build records
 * under is passed over, as `layMainline` says why, and the suite has no base.
 */
async function baseAndFold(
  root: string,
  suite: string,
  records: readonly string[] | undefined,
  here: Here,
): Promise<{ readonly read: MainlineBase | undefined; readonly said: string; readonly notices: readonly string[]; readonly landed: readonly string[] }> {
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = declaredIn(selection.declaredSuites(root), suite);
  const fetch = selection.mainlineHanded(root, suite) ? {} : { fetch: 'always' as const };
  const read = await mainlineBase(root, declared, { ...(here.env === undefined ? {} : { env: here.env }), ...fetch });
  const said =
    read === undefined
      ? `record of "${suite}": not given to the share; its "carry" in the root config is not "share".`
      : `${'miss' in read ? mainlineMissed(read) : mainlineRead(read)}.`;
  const laid = read === undefined || 'miss' in read ? undefined : await layMainline(root, read, instrumentationId());
  const notices = laid !== undefined && 'passed' in laid ? [`${mainlinePassedOver(laid.passed)}. ${noBase(suite)}`] : [];
  if (records !== undefined) {
    const landed = records.length === 0
      ? `${suite}: nothing was handed on, so the base stands.`
      : (await laidAsLeft(root, suite, records)) ?? (await landSuite(root, records, suite));
    return { read, said, notices, landed: [landed] };
  }
  const own = selection.testCoverageFile(root, { suite });
  if (notices.length > 0 || read === undefined || selection.keepsCases(own)) return { read, said, notices, landed: [] };
  const unbased = laid !== undefined
    ? `The ${suite} base record was read without its case index, ${uncased(suite)}`
    : (await recordHeld(own))
      ? ownUncased(suite, own, !('miss' in read))
      : `The mainline's ${suite} record was not read. ${noBase(suite)}`;
  return { read, said, notices: [unbased], landed: [] };
}

const uncased = (suite: string): string =>
  `so ${suite} has nothing to select from or compare with: it runs whole, and its coverage is printed without a comparison.`;

/**
 * A record this checkout already held, which keeps no cases: `layMainline`
 * lays nothing over it, so when the mainline's was read the line says how to
 * take that one instead.
 */
function ownUncased(suite: string, own: string, offered: boolean): string {
  const held = `This checkout already holds a record of "${suite}" at ${own}, and it keeps no cases, ${uncased(suite)}`;
  if (!offered) return held;
  return `${held} The mainline's record is not laid over a record this checkout holds; to take it instead, delete that file, ` +
    `which drops what this checkout ran into it, and run \`variance share --suite ${suite}\` again.`;
}

/**
 * A suite's one record whose runs record says it was laid over a base, put in
 * place with every file named for it, as its job left them: a slice's record,
 * laid over whatever base its job read, the mainline's or the last push's.
 * Landed again, every test it holds from that base would be listed as run at
 * its commit, and a part run would publish as a whole one. A shard's runs
 * record names no base, since it ran in a cache of its own, and it is landed.
 */
async function laidAsLeft(root: string, suite: string, records: readonly string[]): Promise<string | undefined> {
  const [record] = records;
  if (record === undefined || records.length > 1) return undefined;
  const selection = await import('@variance-authority/sense/test-selection');
  if ((await selection.readCommitRuns(record).catch(() => undefined))?.over === undefined) return undefined;
  const target = selection.testCoverageFile(root, { suite });
  const [from, to] = [record, target].map((file) => `${basename(file).replace(/\.bin$/u, '')}.`);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(record, target);
  for (const name of await readdir(dirname(record))) {
    const beside = name !== basename(record) && name.startsWith(from!) && !name.endsWith('.tmp');
    if (beside) await copyFile(join(dirname(record), name), join(dirname(target), `${to}${name.slice(from!.length)}`));
  }
  return `${suite}: its record, laid over a base in its job, as that job left it.`;
}

const noBase = (suite: string): string => `So ${suite} has no base: it runs whole, and its coverage is printed without a comparison.`;

/** {@link suiteShare}'s lines alone. */
export async function suiteShareLines(root: string, options: SuiteShareOptions, here: Here = {}): Promise<readonly string[]> {
  return (await suiteShare(root, options, here)).lines;
}

/**
 * The runner's list of collected test files, as paths relative to the
 * repository root, which is how the runs record names them. A list that cannot
 * be read is refused: the publish was told to count against it.
 */
export async function collectedIn(root: string, file: string): Promise<ReadonlySet<string>> {
  let listed: string;
  try {
    listed = await readFile(resolve(root, file), 'utf8');
  } catch (error) {
    throw new OperatorError(`\`--collected\` names ${file}, which does not read: ${error instanceof Error ? error.message : String(error)}`);
  }
  // git answers where `root` sits under the repository root, so no path is
  // compared across a symbolic link (`/tmp` and `/private/tmp`).
  const prefix = await gitLine(root, ['rev-parse', '--show-prefix'], true);
  if (prefix === undefined) throw new OperatorError(`\`--collected\` needs a git checkout, and ${root} is not in one`);
  const real = await realpath(root);
  const inRoot = (line: string): string => {
    if (!isAbsolute(line)) return line;
    return relative(line.startsWith(`${real}${sep}`) ? real : root, line);
  };
  return new Set(
    listed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => posix.normalize(`${prefix}${inRoot(line).split(sep).join('/')}`)),
  );
}

/** The suite named `suite`, refused when the root config does not declare it. */
function declaredIn(declared: readonly DeclaredSuite[] | undefined, suite: string): DeclaredSuite {
  const found = declared?.find((one) => one.name === suite);
  if (found !== undefined) return found;
  throw new OperatorError(
    declared === undefined
      ? `the suite "${suite}" is named, and the root variance.config.json declares no suites`
      : `the suite "${suite}" is not declared in the root variance.config.json, which declares ${declared.map((one) => `"${one.name}"`).join(', ')}`,
  );
}

/** The checkout's HEAD commit, or nothing outside git or before a first commit. */
export function headOf(cwd: string): Promise<string | undefined> {
  return gitLine(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
}

/** git's one line of answer; `empty` when an empty answer is one, as `--show-prefix` gives at the repository root. */
function gitLine(cwd: string, args: readonly string[], empty = false): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (error, stdout) =>
      resolve(error === null && (empty || stdout.trim() !== '') ? stdout.trim() : undefined),
    );
  });
}
