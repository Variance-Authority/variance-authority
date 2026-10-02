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
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { publishLine } from '@variance-authority/core/share';
import type { DeclaredSuite } from '@variance-authority/sense/test-selection';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, type ExitCode } from '../exit.js';
import { entryCarriesEyes, suiteEntry, suiteEntryOf } from '../share-entries.js';
import { descendsOf, lineCellOf, lineOfRun } from '../share-lines.js';
import { mainlineBase, mainlineMissed, mainlineRead, rootShare } from './mainline-base.js';
import { describePublish, eyesWritten, type Here, type RunPublish } from './share.js';

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
  options: Pick<SuiteShareOptions, 'collected'> = {},
): Promise<RunPublish> {
  return (await publishOnLine(root, suite, here, options)).done;
}

/** The publish, and whether the line it was for is a mainline, which a refusal is not allowed to pass over. */
async function publishOnLine(
  root: string,
  suite: string,
  here: Here,
  options: Pick<SuiteShareOptions, 'collected'>,
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
  });
  if (entry === undefined) return on({ none: `this checkout holds no record of "${suite}"` });
  if ('unpublished' in entry) return on({ none: `${suiteEntry(suite)} is left out: ${entry.unpublished}` });

  const published = await publishLine(cell, run.line, [entry], {
    descends: run.line.kind === 'mainline' ? await descendsOf(place, run.line.name, root) : async () => undefined,
    // A suite entry names no image.
    image: async (digest) => {
      throw new Error(`a suite record names no image, and was asked for ${digest}`);
    },
  });
  if ('kind' in published) return on({ line: run.line, miss: published, ...noMainline });
  const eyes = entryCarriesEyes(entry) ? eyesWritten([entry.name], published.written) : {};
  return on({ line: run.line, published, ...eyes, ...noMainline });
}

/**
 * What `variance share --suite <name>` prints, and the code it exits with:
 * what the publish did, or the record the reader's mainline holds and where it
 * is kept. A mainline publish that wrote nothing exits `EXIT_OPERATOR`.
 */
export async function suiteShare(
  root: string,
  options: SuiteShareOptions,
  here: Here = {},
): Promise<{ readonly lines: readonly string[]; readonly exit: ExitCode }> {
  const selection = await import('@variance-authority/sense/test-selection');
  if (options.publish) {
    const share = rootShare(selection.rootConfig(root));
    const { done, mainline } = await publishOnLine(root, options.suite, here, options);
    const lines = describePublish(share === undefined ? {} : { share }, done);
    return { lines, exit: mainline && !('published' in done) ? EXIT_OPERATOR : EXIT_CLEAN };
  }
  const declared = declaredIn(selection.declaredSuites(root), options.suite);
  // Asked by name, the remote is asked now, whatever was fetched a moment ago.
  const read = await mainlineBase(root, declared, { ...(here.env === undefined ? {} : { env: here.env }), refetch: true });
  if (read === undefined) {
    return { lines: [`record of "${options.suite}": not given to the share; its "carry" in the root config is not "share".`], exit: EXIT_CLEAN };
  }
  return { lines: [`${'miss' in read ? mainlineMissed(read) : mainlineRead(read)}.`], exit: EXIT_CLEAN };
}

/** `variance share --suite <name>`, from the directory it was run in. */
export async function runSuiteShare(
  options: SuiteShareOptions,
  streams: { readonly out: (text: string) => void },
  root: string = process.cwd(),
): Promise<ExitCode> {
  const done = await suiteShare(root, options);
  streams.out(`${done.lines.join('\n')}\n`);
  return done.exit;
}

/** {@link suiteShare}'s lines alone. */
export async function suiteShareLines(root: string, options: SuiteShareOptions, here: Here = {}): Promise<readonly string[]> {
  return (await suiteShare(root, options, here)).lines;
}

/**
 * The runner's list of collected test files, as paths relative to the
 * repository root, which is how the runs record names them. A list that cannot
 * be read is refused: the publish was told to count against it.
 */
async function collectedIn(root: string, file: string): Promise<ReadonlySet<string>> {
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

function headOf(cwd: string): Promise<string | undefined> {
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
