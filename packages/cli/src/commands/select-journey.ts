/**
 * `variance select --execution <journey file>`: the selection read from a
 * journey file rather than from the recorded suite.
 */

import { readFile, realpath } from 'node:fs/promises';
import { OperatorError } from '../exit.js';
import { readExecutionFor } from './execution-input.js';
import { installDiff, installDiffOfPatch, patchPreimages, withoutManifests } from './installed.js';
import { beyondOf, withWhole } from './select-beyond.js';
import { journeySuite, restingOf } from './select-before.js';
import { suiteOf, type SuiteReading, type SuiteRequest } from './select-suite.js';
import { diffPoint, diffSince } from './since.js';
import { indexUpToCheckout, relationsFor } from './source-graph.js';

/**
 * `--execution`: read a journey file against a change the caller hands in.
 *
 * A journey file names no commit, so it never looks for its own change: it is
 * given one, as a patch, on stdin, or as whatever `--since` measures. Each
 * changed line goes to the regions `variance covering --line` names for it —
 * the innermost holding it, and the one around it when the line opens a region
 * — and only the cases that entered them run. Each changed file is read first from both of its
 * texts, the old one from the blob the patch names, so a comment or a new
 * function between two declarations is not charged to the module's importers.
 * A list of paths is refused: it carries no line, so
 * the only answer it can have is the import graph's, and that is `reach`.
 *
 * The lockfile is read as an install, not as a changed file. A handed-in patch
 * names both ends of it by blob, and the packages that moved between them are
 * walked back through the install to every file that imports them.
 */
export async function journeyReading(request: SuiteRequest & { readonly execution: string }): Promise<SuiteReading> {
  const selection = await import('@variance-authority/sense/test-selection');
  const given = isHanded(request);
  if (!given && request.since === undefined) {
    throw new OperatorError(
      'a journey file names no commit, so the change has to be given: pass `--diff <patch>` ' +
        '(`-` reads stdin) or `--since <ref>`',
    );
  }
  const from = request.since ?? 'HEAD';
  // The diff is named from `cwd`, as the relations and the preimages below are, and git spells it through symlinks.
  const here = await realpath(request.root).catch(() => request.root);
  const text = given ? await handedChange(request) : await diffSince(from, [], undefined, { cwd: here });
  if (text === undefined) {
    return suiteOf({ at: request.execution, given: true, ground: { kind: 'no-diff', from } }, request.atDistance);
  }
  if (!/^diff --git /mu.test(text) && /^@@ /mu.test(text)) {
    throw new OperatorError(
      '`--execution` reads the lines a change moved from the blobs `git diff` names on its `index` ' +
        `line, and the patch handed in is a plain unified diff, starting \`${text.trimStart().split('\n')[0] ?? ''}\`, ` +
        'which names none. Hand in `git diff` of the change, committed or in the working tree.',
    );
  }
  if (!/^diff --git /mu.test(text)) {
    throw new OperatorError(
      `\`--execution\` selects by changed lines, and the change handed in is a list of paths, ` +
        `starting \`${text.trimStart().split('\n')[0] ?? ''}\`. Hand in the patch — \`git diff\`, ` +
        'not `git diff --name-only`. A list of paths can only be answered by the import graph, ' +
        'and that is `variance reach`.',
    );
  }
  const installed = given
    ? await installDiffOfPatch(text, here)
    : await installDiff(await diffPoint(from, [], here), [...selection.changedLines(text).keys()]);
  if (installed !== undefined && 'whole' in installed) {
    return suiteOf({ at: request.execution, given: true, ground: { kind: 'no-install', whole: installed.whole } }, request.atDistance);
  }
  if (request.relations === undefined) await indexUpToCheckout(request.root, undefined, !request.noGit);
  const relations = request.relations ?? await relationsFor(request.root, ['.'], [], [], request.noGit);
  // A bump or a moved manifest is the files it changed, changed whole.
  const beyond = beyondOf(relations, installed);
  const changed = selection.changedLines(withWhole(text, beyond.files));
  // What the suite rests on, moved by the patch or the install, runs the whole suite.
  const suite = await journeySuite(here, request.suite);
  const declared = selection.declaredSuites(here)?.find((one) => one.name === suite);
  const { whole, ...rest } = await restingOf(here, suite, relations, [...changed.keys()], declared?.ignore);
  const base = { at: request.execution, given: true, ...rest };
  if (whole !== undefined) return suiteOf({ ...base, ground: { kind: 'before', whole: whole.says, rests: whole.rests } }, request.atDistance);
  const preimages = await patchPreimages(text, request.root);
  const { read, readings } = selection.readJourneyChange(text, (file) => preimages.get(file), {
    root: request.root,
    relations,
  });
  const unmeasured = selection.unmeasuredOf(declared);
  const options = {
    relations,
    read,
    ...(unmeasured === undefined ? {} : { unmeasured }),
    ...(declared?.ignore === undefined ? {} : { ignore: declared.ignore }),
  };
  const narrowing = await selection.selectJourneyFile(request.execution, changed, options)
    ?? selection.narrowByJourneys((await readExecutionFor(request.execution, changed)).index, changed, options);
  const unread = [...withoutManifests(narrowing.unread, installed?.manifests ?? []), ...beyond.unplaced].sort();
  return suiteOf({ ...base, ground: { kind: 'read', narrowing: { ...narrowing, unread, readings } } }, request.atDistance);
}

/** Whether the change is handed in, as `change` text or as the `--diff` patch, rather than measured. */
export function isHanded(request: Pick<SuiteRequest, 'diff' | 'change'>): boolean {
  return request.change !== undefined || request.diff !== undefined;
}

/** The change handed in: the `change` text, or the `--diff` patch read. */
export async function handedChange(request: Pick<SuiteRequest, 'diff' | 'change'>): Promise<string> {
  return request.change ?? await handedDiff(request.diff!);
}

/** A patch handed in by `--diff`: a file, or `-` for stdin. */
export async function handedDiff(diff: string): Promise<string> {
  return diff === '-' ? await stdin() : await readFile(diff, 'utf8');
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
