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
 */

import { execFile } from 'node:child_process';
import { publishLine } from '@variance-authority/core/share';
import type { DeclaredSuite } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { suiteEntry, suiteEntryOf } from '../share-entries.js';
import { descendsOf, lineCellOf, lineOfRun } from '../share-lines.js';
import { mainlineBase, mainlineMissed, mainlineRead, rootShare } from './mainline-base.js';
import { describePublish, type Here, type RunPublish } from './share.js';

/**
 * Publish this checkout's record of `suite` to the line this run belongs to,
 * at `HEAD`, or say why nothing was written.
 *
 * `HEAD` is the commit the run is at, and the record names the commit it was
 * recorded at; `suiteEntryOf` refuses a record whose commit is not `HEAD`'s,
 * so a record an earlier run left behind is never published as this one's.
 */
export async function publishSuite(root: string, suite: string, here: Here = {}): Promise<RunPublish> {
  const env = here.env ?? process.env;
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = declaredIn(selection.declaredSuites(root), suite);
  if (declared.carry !== 'share') {
    return { none: `the suite "${suite}" is not given to the share; its "carry" in the root config is not "share"` };
  }
  const share = rootShare(selection.rootConfig(root));
  const place = { ...(share === undefined ? {} : { share }), cacheRoot: selection.cacheRootFor(root) };
  const cell = await lineCellOf(place, { cwd: root });
  if (cell === undefined) return { none: 'no share is configured' };
  const run = await lineOfRun(place, env, root);
  if ('none' in run) return run;
  const noMainline = run.noMainline !== undefined ? { noMainline: run.noMainline } : {};
  if ('kind' in cell) return { line: run.line, miss: cell, ...noMainline };

  const commit = await headOf(root);
  if (commit === undefined) return { none: 'this checkout has no commit' };
  const at = { commit, ...(run.head !== undefined ? { head: run.head } : {}) };
  const entry = await suiteEntryOf(root, suite, at, { whole: run.line.kind === 'mainline' });
  if (entry === undefined) return { none: `this checkout holds no record of "${suite}"` };
  if ('unpublished' in entry) return { none: `${suiteEntry(suite)} is left out: ${entry.unpublished}` };

  const published = await publishLine(cell, run.line, [entry], {
    descends: run.line.kind === 'mainline' ? await descendsOf(place, run.line.name, root) : async () => undefined,
    // A suite entry names no image.
    image: async (digest) => {
      throw new Error(`a suite record names no image, and was asked for ${digest}`);
    },
  });
  if ('kind' in published) return { line: run.line, miss: published, ...noMainline };
  return { line: run.line, published, ...noMainline };
}

/**
 * What `variance share --suite <name>` prints: what the publish did, or the
 * record the reader's mainline holds and where it is kept.
 */
export async function suiteShareLines(
  root: string,
  options: { readonly suite: string; readonly publish: boolean },
  here: Here = {},
): Promise<readonly string[]> {
  const selection = await import('@variance-authority/sense/test-selection');
  if (options.publish) {
    const share = rootShare(selection.rootConfig(root));
    return describePublish(share === undefined ? {} : { share }, await publishSuite(root, options.suite, here));
  }
  const declared = declaredIn(selection.declaredSuites(root), options.suite);
  const read = await mainlineBase(root, declared, here.env === undefined ? {} : { env: here.env });
  if (read === undefined) return [`record of "${options.suite}": not given to the share; its "carry" in the root config is not "share".`];
  return [`${'miss' in read ? mainlineMissed(read) : mainlineRead(read)}.`];
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
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd }, (error, stdout) =>
      resolve(error === null && stdout.trim() !== '' ? stdout.trim() : undefined),
    );
  });
}
