/**
 * The half of `variance select` with a disk, a subprocess and a snapshot in it.
 *
 * The decision is next door in [`select.ts`](./select.ts), a pure function over
 * a reading. This is what has to happen before it can be asked: find the
 * journal, learn the commit its line ranges are coordinates in, walk git for the
 * diff, and read the snapshot. The split is the one every narrowing in this
 * package uses, and it matters most here — the rules this command ships are the
 * ones that decide whether somebody else's suite runs, and they have to be
 * assertable with no cache, no repository and no tests.
 *
 * ## No configuration is read, deliberately
 *
 * Every other command that touches a store or a baseline loads
 * `variance.config.json` first, and `loadConfig` refuses when it is not there —
 * correctly, because a run that guessed its subjects would be observing
 * something nobody chose. This command has no subjects. It is asked by a
 * repository whose tests are run by `vitest` or `jest` and which may never have
 * configured this tool for anything else, and requiring a config file would put
 * it out of reach in exactly those repositories.
 *
 * The file graph is built anyway, over the whole checkout, because the answer
 * is wrong without it. A test that mocks a module ran that module's source to
 * learn its shape, so the recording holds it, and what the module contains
 * cannot fail that test — only the graph knows the mock is there, and with it a
 * change behind the mock selects nobody who mocked it. The same graph answers a
 * changed stylesheet or asset no probe can sit in by the module that imports
 * it. With no config there are no taint tables beyond the mock reader, which
 * runs unasked.
 *
 * The root `variance.config.json` is read when there is one, and only for what
 * a record is: which suites are declared, and for a suite given to a share,
 * where the share is. That is the file `variance run` recorded by, so it names
 * the record `select` reads.
 *
 * The install is compared at the same point the diff is measured from, for
 * the reason `variance run --since` compares it: a bumped package changes no
 * line a test covered, so a diff that touched only the lockfile reaches nobody
 * the journal can see. The graph answers a bumped name by the measured files
 * that import it, and a lockfile that cannot be compared declines to narrow.
 */

import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ExecutionNarrowing, Stand, StandReading } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { readExecutionFor } from './execution-input.js';
import {
  installDiff,
  installDiffOfPatch,
  movedPackages,
  patchPreimages,
  withMovedPackages,
  withoutManifests,
} from './installed.js';
import { isMissing, journeyAgainst } from './resources.js';
import { diffPoint, diffSince } from './since.js';
import { checkoutRead, mainlineBase, mainlineMissed, mainlineRead } from './mainline-base.js';
import { many } from './reach.js';
import { relationsFor } from './source-graph.js';
import { landingRecord, recordedSuite } from './suite-record.js';
import {
  formatSelection,
  selectionNotes,
  skippableTests,
  type SelectFormat,
  type SelectGround,
  type SelectInput,
  type SelectSource,
} from './select.js';

/** What `variance select` was asked for, once the flags are off the command line. */
export interface SelectRequest {
  readonly cwd: string;
  /** `--since <ref>`: where to measure from when the journal names no commit of its own. */
  readonly since?: string;
  readonly format: SelectFormat;
  readonly noGit?: boolean;
  /** `--execution <file>`: a journey file to read instead of the recorded journal. */
  readonly execution?: string;
  /** `--diff <patch>`: the change, handed in; `-` is stdin. */
  readonly diff?: string;
  /** `--suite <name>`: whose record is read, when more than one suite is declared. */
  readonly suite?: string;
}

/**
 * The two streams, kept apart by the caller that writes them.
 *
 * Returned as a pair rather than written here, so the whole command is one
 * value a test can read — and so that nothing in the reading can reach stdout
 * by accident, which is the property the skip list rests on.
 */
export interface SelectOutput {
  /** Skip data, and nothing else. */
  readonly out: string;
  /** Everything a person needs and no runner may parse. */
  readonly err: string;
}

/** Read the journal against what has changed, and say what may be skipped. */
export async function selectOutput(request: SelectRequest): Promise<SelectOutput> {
  const selection = await import('@variance-authority/sense/test-selection');
  // A snapshot handed in by path — the JVM agent's `coverage.va` — is read the
  // way this checkout's own is. Anything else `--execution` names is a journey
  // file.
  if (
    request.execution !== undefined &&
    !((await exists(request.execution)) && selection.isTestCoverageFile(request.execution))
  ) {
    return await journeyOutput({ ...request, execution: request.execution });
  }
  const found = request.execution === undefined ? await recordedOrMainline(request) : { at: request.execution, held: true };
  const { at, source } = found;
  const said = (input: Parameters<typeof saidOf>[0]) =>
    saidOf(source === undefined ? input : { ...input, source }, request);

  // Asked of the file before anything is decoded, because *no recording here*
  // is the ordinary state of a repository and must not arrive as a failure to
  // produce a diff — which is what an operator would see if the commit were
  // looked for first and the answer were "pass --since".
  if (!found.held) {
    return said({ at, ground: { kind: 'no-journal' } });
  }

  // The position, and nothing else decoded to reach it. A snapshot of this
  // repository holds hundreds of thousands of regions and this asks it for
  // forty characters. A file that cannot be read at all answers `undefined`
  // here and throws by name a moment later, where the message belongs.
  const commit = await selection.recordedCommit(at);
  const from = commit ?? request.since;
  if (from === undefined && request.diff === undefined) {
    // `recordedCommit` answers `undefined` for two different files: one that
    // names no commit, and one this build cannot read at all. Those are an
    // operator's two different afternoons, and the reader is what tells them
    // apart — asked here for the empty diff, so an unreadable snapshot is
    // refused by name instead of being reported as a missing coordinate.
    await journeyAgainst(request.cwd, '', undefined, [], at);
    throw new OperatorError(
      `the execution journal at ${at} names no commit, so there is no coordinate to measure a ` +
        'diff from. Pass `--since <ref>` to name one, or record the suite again from a git ' +
        'checkout so the journal carries its own; a selection measured from a guess would skip ' +
        'test files for lines nobody changed.',
    );
  }

  // The journal's own commit wins whenever it has one, `--since` or not: its
  // line ranges are coordinates in that commit's text and nothing else's, and a
  // diff read from anywhere further back lands its hunks on regions belonging
  // to other tests. `--since` names the base only when the journal cannot. A
  // patch handed in with `--diff` is the change as given.
  const base = from ?? 'HEAD';
  // The journal's commit is the commit of its latest run, and a partial run —
  // a runner handed the last skip list — leaves every test it did not run on the
  // text it last ran on. The runs recorded beside the journal say where each
  // one stands, and what changed from there to the journal's commit is read
  // whole for it. A test the runs do not place is read from the journal's
  // commit, or from where its runs started, and a note says so.
  const stood = commit === undefined || request.diff !== undefined ? undefined : await standsOf(at);
  const stands = stood?.stands ?? [];
  const standing = stood === undefined ? [] : standingNotes(stood.reading, commit!);
  const recorded = { at, ...(commit === undefined ? {} : { commit }), ...(standing.length === 0 ? {} : { standing }) };
  if (stood?.reading.widened !== undefined) {
    return said({ ...recorded, ground: { kind: 'no-diff', from: stood.reading.from! } });
  }
  const diff = request.diff === undefined
    ? await diffSince(request.since ?? base, [], commit)
    : await handedDiff(request.diff);
  if (diff === undefined) {
    const ground: SelectGround = { kind: 'no-diff', from: base };
    return said({ ...recorded, ground });
  }
  const before = stands.flatMap((stand) => stand.whole);

  // Read at the point the change starts — the journal's own commit, or where
  // the oldest test last ran before it, or the merge base with `--since` — so a
  // bump is one this change made and not one `main` made since. `undefined` is
  // no lockfile to compare, which moves nothing; a comparison that could not be
  // made declines before the graph is scanned for an answer nobody will read.
  const installed = request.diff === undefined
    ? await installDiff(await diffPoint(stood?.reading.from ?? base), [...new Set([...selection.changedLines(diff).keys(), ...before])])
    : await installDiffOfPatch(diff);
  if (installed !== undefined && 'whole' in installed) {
    const ground: SelectGround = { kind: 'no-install', whole: installed.whole };
    return said({ ...recorded, ground });
  }

  const relations = await relationsFor(request.cwd, ['.'], [], [], {
    why: 'a mocked module is ruled out by the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  }, request.noGit);
  // A package whose manifest moved is every file of it, changed whole.
  const moved = movedPackages(relations, installed);
  // The files a stand reads whole leave the hunk diff, so none is also read by its hunks.
  const ask = (whole: readonly string[]) =>
    journeyAgainst(
      request.cwd,
      withMovedPackages([selection.withoutFiles(diff, whole), ...whole.map(selection.wholeEntry)].join('\n'), moved.files),
      relations,
      installed?.packages,
      at,
    );
  const narrowing = stands.length === 0 ? await ask([]) : await perStand(stands, ask);
  // The lockfile and the manifests beside it are unread by the journal and
  // answered by the comparison above, which has already said what moved.
  const ground: SelectGround =
    narrowing === undefined
      ? { kind: 'no-journal' }
      : {
          kind: 'read',
          narrowing: {
            ...narrowing,
            unread: [...withoutManifests(narrowing.unread, installed?.manifests ?? []), ...moved.unplaced].sort(),
          },
        };

  return said({ ...recorded, ground });
}

/**
 * Where each test in the journal at `at` last ran, as the runs recorded beside
 * it say, with the files read whole for each stand named the way this run
 * names files. `undefined` outside a checkout, or for a journal that names no
 * commit.
 */
async function standsOf(
  at: string,
): Promise<{ readonly reading: StandReading; readonly stands: readonly Stand[] } | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  const cwd = process.cwd();
  let repository: string;
  try {
    repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const reading = await selection.standsAt(at, git);
  if (reading === undefined) return undefined;
  // `git` names files from the top of the checkout and the diff names them from here.
  const here = (file: string): string => relative(cwd, join(repository, file));
  return { reading, stands: reading.stands.map((stand) => ({ ...stand, whole: stand.whole.map(here) })) };
}

/** What the journal says about where its tests last ran, as notes after the verdict. */
function standingNotes(reading: StandReading, commit: string): readonly string[] {
  const notes = reading.stands.map(
    (stand) =>
      `${many(stand.tests.length, 'test file')} last ran at ${stand.commit.slice(0, 12)}, before the journal's commit ` +
      `${commit.slice(0, 12)}, so the ${many(stand.whole.length, 'file')} changed between the two ` +
      `${stand.whole.length === 1 ? 'is' : 'are'} read whole for ${stand.tests.length === 1 ? 'it' : 'them'}`,
  );
  if (reading.widened !== undefined) notes.push(reading.widened);
  if (reading.assumed !== undefined) notes.push(reading.assumed);
  return notes;
}

/**
 * The journal asked once per stand, each answer kept for the tests standing
 * there. A journal that is gone by the time it is asked again answers
 * `undefined`, the way a journal that was never there does.
 */
async function perStand(
  stands: readonly Stand[],
  ask: (whole: readonly string[]) => Promise<ExecutionNarrowing | undefined>,
): Promise<ExecutionNarrowing | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  let missing = false;
  const { narrowing } = await selection.askPerStand(stands, async (whole) => {
    const answer = await ask(whole);
    if (answer === undefined) missing = true;
    return { narrowing: answer ?? { whole: [], entered: [], unread: [], stale: [], because: [] } };
  });
  return missing ? undefined : narrowing;
}

/**
 * This checkout's record of the suite — in a worktree that has not run, the
 * primary checkout's — or, when neither has one and the suite is given to a
 * share, the one its mainline published (spec 0074, item 5).
 *
 * The local record wins whenever it is on disk, and nothing is fetched then.
 * For a suite given to a share, either way, the first note after the verdict
 * says whose record it read, because the two select differently and an
 * operator reading a skip list cannot tell them apart otherwise.
 */
async function recordedOrMainline(
  request: SelectRequest,
): Promise<{ readonly at: string; readonly held: boolean; readonly source?: SelectSource }> {
  const recorded = await recordedSuite(request.cwd, request.suite);
  const suite = recorded.declared?.carry === 'share' ? recorded.declared.name : undefined;
  if (await exists(recorded.file)) {
    if (suite === undefined) return { at: recorded.file, held: true };
    const own = recorded.file === (await landingRecord(request.cwd, request.suite));
    return { at: recorded.file, held: true, source: { from: 'checkout', says: checkoutRead(suite, own ? undefined : recorded.file) } };
  }
  const read = await mainlineBase(request.cwd, recorded.declared);
  if (read === undefined) return { at: recorded.file, held: false };
  if ('miss' in read) {
    const mainline = read.mainline === undefined ? {} : { mainline: read.mainline };
    return { at: recorded.file, held: false, source: { ...mainline, says: mainlineMissed(read) } };
  }
  const distance = read.distance === undefined ? {} : { distance: read.distance };
  return { at: read.coverage, held: true, source: { from: 'mainline', mainline: read.mainline, ...distance, says: mainlineRead(read) } };
}

/**
 * `--execution`: read a journey file against a change the caller hands in.
 *
 * A journey file names no commit, so it never looks for its own change: it is
 * given one, as a patch, on stdin, or as whatever `--since` measures. Each
 * changed line goes to the innermost region holding it, and only the cases that
 * entered that region run. Each changed file is read first from both of its
 * texts, the old one from the blob the patch names, so a comment or a new
 * function between two declarations is not charged to the module's importers.
 * A list of paths is refused: it carries no line, so
 * the only answer it can have is the import graph's, and that is `reach`.
 *
 * The lockfile is read as an install, not as a changed file. A handed-in patch
 * names both ends of it by blob, and the packages that moved between them are
 * walked back through the install to every file that imports them.
 */
async function journeyOutput(request: SelectRequest & { readonly execution: string }): Promise<SelectOutput> {
  const selection = await import('@variance-authority/sense/test-selection');
  if (request.diff === undefined && request.since === undefined) {
    throw new OperatorError(
      'a journey file names no commit, so the change has to be given: pass `--diff <patch>` ' +
        '(`-` reads stdin) or `--since <ref>`',
    );
  }
  const from = request.since ?? 'HEAD';
  const text = request.diff === undefined ? await diffSince(from) : await handedDiff(request.diff);
  if (text === undefined) {
    return saidOf({ at: request.execution, given: true, ground: { kind: 'no-diff', from } }, request);
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
  const installed = request.diff === undefined
    ? await installDiff(await diffPoint(from), [...selection.changedLines(text).keys()])
    : await installDiffOfPatch(text);
  if (installed !== undefined && 'whole' in installed) {
    return saidOf({ at: request.execution, given: true, ground: { kind: 'no-install', whole: installed.whole } }, request);
  }
  const relations = await relationsFor(request.cwd, ['.'], [], [], {
    why: 'a whole-file change is answered by the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  }, request.noGit);
  // A package whose manifest moved is every file of it, changed whole.
  const moved = movedPackages(relations, installed);
  const changed = selection.changedLines(withMovedPackages(text, moved.files));
  const preimages = await patchPreimages(text, request.cwd);
  const { read, readings } = selection.readJourneyChange(text, (file) => preimages.get(file), {
    root: request.cwd,
    relations,
  });
  const options = { relations, packages: installed?.packages ?? [], read };
  const narrowing = await selection.selectJourneyFile(request.execution, changed, options)
    ?? selection.narrowByJourneys((await readExecutionFor(request.execution, changed)).index, changed, options);
  const unread = [...withoutManifests(narrowing.unread, installed?.manifests ?? []), ...moved.unplaced].sort();
  return saidOf(
    { at: request.execution, given: true, ground: { kind: 'read', narrowing: { ...narrowing, unread, readings } } },
    request,
  );
}

/** A patch handed in by `--diff`: a file, or `-` for stdin. */
async function handedDiff(diff: string): Promise<string> {
  return diff === '-' ? await stdin() : await readFile(diff, 'utf8');
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function saidOf(
  input: SelectInput,
  request: { readonly format: SelectFormat; readonly cwd: string },
): SelectOutput {
  const selection = skippableTests(input);
  return {
    out: formatSelection(selection, request.format, request.cwd),
    err: selectionNotes(selection),
  };
}

/**
 * Whether the journal is on disk, distinguishing *missing* from *unreadable*.
 *
 * Anything other than ENOENT is handed on: a directory in its place, a
 * permission the operator lost, a mount that went away. Reporting those as "no
 * recording here" would be the one failure this whole subsystem is written to
 * refuse — a run that ignored a snapshot looking exactly like a run that never
 * had one.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw new OperatorError(
      `the recorded execution journal at ${file} could not be reached: ` +
        `${error instanceof Error ? error.message : String(error)}. A selection that treated ` +
        'this as "nothing recorded" would skip nothing and look exactly like a clean answer.',
      { cause: error },
    );
  }
}
