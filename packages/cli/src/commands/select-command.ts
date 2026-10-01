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
 * the journal can see. A test that last ran before the journal's commit ran on
 * the install at that commit, so its install is compared from there. The graph
 * answers a bumped name by the measured files that import it, and a lockfile
 * that cannot be compared declines to narrow.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitRuns, ExecutionNarrowing, Stand, StandReading } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { readExecutionFor } from './execution-input.js';
import { installDiff, installDiffs, installDiffOfPatch, movedPackages, type InstallDiff } from './installed.js';
import { patchPreimages, withMovedPackages, withoutManifests } from './installed.js';
import { isMissing, journeyAgainst } from './resources.js';
import { commitPoint, diffPoint, diffSince, topLevel } from './since.js';
import { checkoutRead } from './checkout-read.js';
import { mainlineMissed, mainlineRead, primaryRead } from './mainline-base.js';
import { many } from './reach.js';
import { relationsFor } from './source-graph.js';
import { suiteBase } from './suite-base.js';
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
  // commit, or from where its runs started, and a note says so. A patch handed
  // in is the whole change, so it is read for every test alike, and a note says
  // when some test last ran before the journal's commit.
  const handed = request.diff !== undefined;
  // The stands, the diff, the installs and the import graph are named from the top
  // of the checkout `cwd` is in, as git spells it, which is how the journal names files.
  const top = await topLevel(request.cwd);
  const here = top ?? request.cwd;
  const own = at === (await landingRecord(request.cwd, request.suite));
  const stood = commit === undefined || top === undefined ? undefined : await standsOf(at, top, handed, own);
  const reading = stood === undefined || 'unread' in stood ? undefined : stood.reading;
  const standing =
    stood === undefined ? [] : 'unread' in stood ? [stood.unread] : handed ? handedNotes(stood.reading, commit!) : standingNotes(stood.reading, commit!);
  const stands = handed || stood === undefined || 'unread' in stood ? [] : stood.stands;
  const recorded = { at, ...(commit === undefined ? {} : { commit }), ...(standing.length === 0 ? {} : { standing }) };
  if (!handed && reading?.widened !== undefined) {
    return said({ ...recorded, ground: { kind: 'no-diff', from: reading.from! } });
  }
  const diff = request.diff === undefined
    ? await diffSince(request.since ?? base, [], commit, { cwd: here })
    : await handedDiff(request.diff);
  if (diff === undefined) {
    const ground: SelectGround = { kind: 'no-diff', from: base };
    return said({ ...recorded, ground });
  }

  // Read at the commit each group of tests last ran at — the journal's own, or
  // a stand's, exactly, on whatever line it is — or at the merge base with
  // `--since` when the journal names none, so a bump is one made after those
  // tests ran and not one `main` made since, and a bump made and undone after a
  // test ran is no bump for it. Keyed by the stand's commit, `undefined` for
  // the journal's own. `undefined` is no lockfile to compare, which moves
  // nothing; a comparison that could not be made — from a commit git could not
  // resolve here — declines before the graph is scanned for an answer
  // nobody will read. The lockfile on disk is parsed once for every group.
  const changed = [...selection.changedLines(diff).keys()];
  const installs = new Map<string | undefined, InstallDiff | undefined>();
  if (request.diff !== undefined) installs.set(undefined, await installDiffOfPatch(diff, here));
  else {
    const groups = [undefined, ...stands];
    const asked = await Promise.all(groups.map(async (stand) => ({
      point: commit === undefined ? await diffPoint(base, [], here) : await commitPoint(stand?.commit ?? commit, [], here),
      changed: stand === undefined ? changed : [...new Set([...changed, ...stand.whole])],
    })));
    const answers = await installDiffs(asked, here);
    groups.forEach((stand, index) => installs.set(stand?.commit, answers[index]));
  }
  for (const installed of installs.values()) {
    if (installed !== undefined && 'whole' in installed) {
      const ground: SelectGround = { kind: 'no-install', whole: installed.whole };
      return said({ ...recorded, ground });
    }
  }

  const relations = await relationsFor(here, ['.'], [], [], {
    why: 'a mocked module is ruled out by the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  }, request.noGit);
  // A package whose manifest moved is every file of it, changed whole.
  const moved = new Map([...installs].map(([stand, installed]) => [stand, movedPackages(relations, installed)] as const));
  // The files a stand reads whole leave the hunk diff, so none is also read by
  // its hunks, and each group is charged the packages that moved since it ran.
  const ask = (whole: readonly string[], stand: string | undefined) =>
    journeyAgainst(
      here,
      withMovedPackages([selection.withoutFiles(diff, whole), ...whole.map(selection.wholeEntry)].join('\n'), moved.get(stand)!.files),
      relations,
      compared(installs.get(stand))?.packages,
      at,
      request.cwd,
    );
  const narrowing = stands.length === 0 ? await ask([], undefined) : await perStand(stands, ask);
  // The lockfile and the manifests beside it are unread by the journal and
  // answered by the comparisons above, which have already said what moved.
  const manifests = [...installs.values()].flatMap((installed) => compared(installed)?.manifests ?? []);
  const unplaced = [...moved.values()].flatMap((one) => one.unplaced);
  const ground: SelectGround =
    narrowing === undefined
      ? { kind: 'no-journal' }
      : {
          kind: 'read',
          narrowing: {
            ...narrowing,
            unread: [...new Set([...withoutManifests(narrowing.unread, manifests), ...unplaced])].sort(),
          },
        };

  return said({ ...recorded, ground });
}

/** An install comparison that was made, or `undefined` for one there was nothing to make. */
function compared(installed: InstallDiff | undefined): Exclude<InstallDiff, { readonly whole: string }> | undefined {
  return installed === undefined || 'whole' in installed ? undefined : installed;
}

/**
 * Where each test in the journal at `at` last ran, as the runs recorded beside
 * it say, with the files read whole for each stand named from the top of
 * `repository`, as the journal names them. `undefined` for a journal
 * that names no commit. A runs record that cannot be read is refused, with the reader's sentence
 * naming the file: every test would otherwise be read from a guess, and a guess
 * can skip a test that should run. Under `--diff` the record feeds only a note,
 * so the note says it could not be read and nothing is refused.
 */
async function standsOf(
  at: string,
  repository: string,
  handed: boolean,
  own: boolean,
): Promise<{ readonly reading: StandReading; readonly stands: readonly Stand[] } | { readonly unread: string } | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  let runs: CommitRuns | undefined;
  try {
    runs = await selection.readCommitRuns(at);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    if (handed) {
      return { unread: `${why}, so whether a test file last ran before the journal's commit is not said; a patch handed in with \`--diff\` is read as the whole change either way` };
    }
    // One case per place a journal is read from: this checkout's own, or another's it reads until it has run.
    const remedy = own
      ? 'Run the suite, which rewrites it; delete it first only if it is a directory.'
      : "It is another checkout's record: run the suite here, which writes this checkout's own.";
    throw new OperatorError(
      `${why}. It says where each test in the journal last ran, and a selection that guessed would skip ` +
        `tests that should run. ${remedy}`,
      { cause: error },
    );
  }
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const reading = selection.standsAt(at, runs, git, (test) => existsSync(join(repository, test)));
  return reading === undefined ? undefined : { reading, stands: reading.stands };
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
  const gone = reading.gone ?? [];
  const [is, it, more] = gone.length === 1 ? ['is', 'it', ''] : ['are', 'them', gone.length > 5 ? `, and ${gone.length - 5} more` : ''];
  if (gone.length > 0) notes.push(`${many(gone.length, 'test file')} the runs record places before the journal's commit ${commit.slice(0, 12)} ${is} not on disk, so no stand is read for ${it}: ${gone.slice(0, 5).join(', ')}${more}`);
  return notes;
}

/**
 * What a patch handed in leaves unread: the tests that last ran before the
 * journal's commit are read against the patch alone, not against what changed
 * before it.
 */
function handedNotes(reading: StandReading, commit: string): readonly string[] {
  const count = reading.stands.reduce((sum, stand) => sum + stand.tests.length, 0);
  if (count === 0 && reading.widened === undefined) return [];
  const which = count === 0 ? 'some test files' : many(count, 'test file');
  const at = commit.slice(0, 12);
  return [
    `${which} last ran before the journal's commit ${at}, and a patch handed in with \`--diff\` is read as the ` +
      `whole change, so what changed before ${at} is not read for ${count === 1 ? 'it' : 'them'}. Leave out ` +
      '`--diff` to read the working tree against where each test last ran',
  ];
}

/**
 * The journal asked once per stand, each answer kept for the tests standing
 * there. A journal that is gone by the time it is asked again answers
 * `undefined`, the way a journal that was never there does.
 */
async function perStand(
  stands: readonly Stand[],
  ask: (whole: readonly string[], stand: string | undefined) => Promise<ExecutionNarrowing | undefined>,
): Promise<ExecutionNarrowing | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  let missing = false;
  const { narrowing } = await selection.askPerStand(stands, async (whole, stand) => {
    const answer = await ask(whole, stand);
    if (answer === undefined) missing = true;
    return { narrowing: answer ?? { whole: [], entered: [], unread: [], stale: [], because: [] } };
  });
  return missing ? undefined : narrowing;
}

/**
 * The record of the suite this checkout measures from, in the order `suiteBase` gives every base
 * reader: this checkout's own, else the mainline's (ADR-0084), else, in a worktree, the primary
 * checkout's as the offline fallback.
 *
 * A suite the root config does not give to a share has no mainline record, and reads the nearest
 * layer that holds one. For a suite given to a share the first note after the verdict says whose
 * record it read, because they select differently and a skip list alone does not say which.
 */
async function recordedOrMainline(
  request: SelectRequest,
): Promise<{ readonly at: string; readonly held: boolean; readonly source?: SelectSource }> {
  const recorded = await recordedSuite(request.cwd, request.suite);
  const suite = recorded.declared?.carry === 'share' ? recorded.declared.name : undefined;
  if (suite === undefined) return { at: recorded.file, held: await exists(recorded.file) };
  const base = await suiteBase(request.cwd, { suite });
  if (base.from === 'own') return { at: base.file, held: true, source: { from: 'checkout', says: checkoutRead(suite, request.cwd, base) } };
  if (base.from === 'mainline') {
    const read = base.mainline;
    const distance = read.distance === undefined ? {} : { distance: read.distance };
    return { at: read.coverage, held: true, source: { from: 'mainline', mainline: read.mainline, ...distance, says: mainlineRead(read) } };
  }
  const mainline = base.missed?.mainline === undefined ? {} : { mainline: base.missed.mainline };
  if (base.from === 'primary') {
    return { at: base.file, held: true, source: { from: 'checkout', ...mainline, says: primaryRead(suite, base.file, base.missed) } };
  }
  if (base.missed === undefined) return { at: base.file, held: false };
  return { at: base.file, held: false, source: { ...mainline, says: mainlineMissed(base.missed) } };
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
  // The diff is named from `cwd`, as the relations and the preimages below are, and git spells it through symlinks.
  const here = await realpath(request.cwd).catch(() => request.cwd);
  const text = request.diff === undefined ? await diffSince(from, [], undefined, { cwd: here }) : await handedDiff(request.diff);
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
    ? await installDiff(await diffPoint(from, [], here), [...selection.changedLines(text).keys()])
    : await installDiffOfPatch(text, here);
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
