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
 * ## Configuration is optional
 *
 * Every other command that touches a store or a baseline refuses without
 * `variance.config.json`, because a run that guessed its subjects would observe
 * something nobody chose. This command has no subjects, and is asked by
 * repositories whose tests `vitest` or `jest` run and which may configure this
 * tool for nothing else. The root config is read when there is one, for what a
 * record is — the declared suites, and the share a suite is given to — and for
 * what each suite rests on before reach: its `before`, and the repository's.
 * A change anywhere those entries load runs the whole suite
 * ([`select-before.ts`](./select-before.ts)).
 *
 * The file graph is built over the whole checkout, because the answer is wrong
 * without it. A test that mocks a module ran that module's source to learn its
 * shape, so the recording holds it, but only the graph knows the mock is there.
 * The same graph answers a changed stylesheet or asset by the module that
 * imports it. No taint table is read beyond the mock reader, which runs unasked.
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
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommitRuns, ExecutionNarrowing, Stand, StandQuestion, StandReading } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { installDiffs, installDiffOfPatch, ranOn, withoutManifests, type InstallDiff } from './installed.js';
import { beyondOf, compared, installReached, withWhole } from './select-beyond.js';
import { isMissing, journeyAgainst, recordAgainst, recordPerStand } from './resources.js';
import { commitPoint, diffPoint, diffSince, topLevel } from './since.js';
import { checkoutRead } from './checkout-read.js';
import { mainlineMissed, mainlineRead, primaryRead } from './mainline-base.js';
import { many } from './prose-counts.js';
import { restingOf } from './select-before.js';
import { handedDiff, journeyReading } from './select-journey.js';
import type { Leg } from './select-leg.js';
import { suiteOf, type SuiteReading, type SuiteRequest } from './select-suite.js';
import { relationsFor } from './source-graph.js';
import { suiteBase } from './suite-base.js';
import { landingRecord, oneRecord, recordedSuite } from './suite-record.js';
import {
  formatSelection,
  selectionNotes,
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
  /** `--at-distance <hops>`: one leg of the selection, by import hops from the change. */
  readonly atDistance?: Leg;
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
  const { cwd, format, ...asked } = request;
  const { reading } = await selectSuite({ root: cwd, ...asked });
  return { out: formatSelection(reading, format, cwd), err: deprecated(format) + selectionNotes(reading) };
}

/**
 * The two runner formats hand a selection to a runner on its command line,
 * which a large one outgrows; the seam takes it in memory instead (spec 0098).
 * They print this for one minor release, then go without an alias.
 */
function deprecated(format: SelectFormat): string {
  if (format !== 'vitest' && format !== 'jest') return '';
  return (
    `\`--format ${format}\` is deprecated: set VARIANCE_AUTHORITY_SINCE, and a config wrapped by \`withTestSelection\` ` +
    'drops the skipped files inside the runner, with no path on its command line\n'
  );
}

/**
 * The selection, as the sets a runner acts on and the reading `variance select`
 * prints. Every caller asks this one function: the command, and each seam that
 * drops the files in `skip` inside its runner.
 */
export async function selectSuite(request: SuiteRequest): Promise<SuiteReading> {
  const selection = await import('@variance-authority/sense/test-selection');
  // A snapshot handed in by path — the JVM agent's `coverage.va` — is read the
  // way this checkout's own is. Anything else `--execution` names is a journey
  // file.
  if (
    request.execution !== undefined &&
    !((await exists(request.execution)) && selection.isTestCoverageFile(request.execution))
  ) {
    return await journeyReading({ ...request, execution: request.execution });
  }
  // A snapshot named by path is the record, and so is the one `--suite` names.
  oneRecord(request.suite, request.execution, '--execution');
  const found = request.execution === undefined ? await recordedOrMainline(request) : { at: request.execution, held: true };
  const { at, source } = found;
  const said = (input: SelectInput) => suiteOf(source === undefined ? input : { ...input, source }, request.atDistance);

  // Asked of the file before anything is decoded, because *no recording here*
  // is the ordinary state of a repository and must not arrive as a failure to
  // produce a diff — which is what an operator would see if the commit were
  // looked for first and the answer were "pass --since". So is a record whose
  // run instrumented nothing, read off its header: it measured nothing either.
  if (!found.held) return said({ at, ground: { kind: 'no-journal' } });
  if (selection.withoutCoverage(at)) return said({ at, ground: { kind: 'no-coverage' } });

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
    await journeyAgainst(request.root, '', undefined, at);
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
  // for it from both texts. A test the runs do not place is read from the journal's
  // commit, or from where its runs started, and a note says so. A patch handed
  // in is the whole change, so it is read for every test alike, and a note says
  // when some test last ran before the journal's commit.
  const handed = request.diff !== undefined;
  // The stands, the diff, the installs and the import graph are named from the top
  // of the checkout `cwd` is in, as git spells it, which is how the journal names files.
  const top = await topLevel(request.root);
  const here = top ?? request.root;
  const own = at === (await landingRecord(request.root, request.suite));
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
  // Where the runs record kept the install a group's tests ran on, its commit
  // is read through it: a bump they ran on uncommitted is no bump for them,
  // and one undone since is. A kept text this checkout cannot read is
  // half an install, so the commit's is read whole and a note says so, one
  // for each commit it happened at.
  const changed = [...selection.changedLines(diff).keys()];
  const installs = new Map<string | undefined, InstallDiff | undefined>();
  const unkept = new Set<string>();
  const ranOver = new Set<string | undefined>();
  if (request.diff !== undefined) installs.set(undefined, await installDiffOfPatch(diff, here));
  else {
    const groups = [undefined, ...stands];
    const asked = await Promise.all(groups.map(async (stand) => {
      const point = commit === undefined ? await diffPoint(base, [], here) : await commitPoint(stand?.commit ?? commit, [], here);
      const installed = stand === undefined ? reading?.installed : stand.installed;
      const ran = point === undefined || installed === undefined ? point : ranOn(point, installed, selection.keptTexts(request.root));
      const missing = ran !== undefined && 'missing' in ran;
      const at = (stand?.commit ?? commit)?.slice(0, 12);
      const note = missing
        ? `the suite ran over a ${ran.missing} that ${at} does not hold, and that text is not kept here, so the install is compared from ${at}`
        : undefined;
      if (!missing && ran !== point) ranOver.add(stand?.commit);
      // A manifest the run kept is compared whether or not the tree still
      // differs from the commit there: one undone since moved for these tests.
      const kept = missing || ran === point ? [] : Object.keys(installed!);
      return {
        point: missing ? point : ran,
        changed: [...new Set([...changed, ...(stand?.changed ?? []), ...kept])],
        note,
      };
    }));
    for (const { note } of asked) if (note !== undefined) unkept.add(note);
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
  // A bump or a moved manifest is the files it changed, changed whole.
  const beyond = new Map([...installs].map(([stand, installed]) => [stand, beyondOf(relations, installed)] as const));
  // What the suite rests on before reach, moved by any group's diff or install, runs the whole suite.
  const declared = (await recordedSuite(here, request.suite, 'landing')).declared;
  const suite = declared?.name;
  const beyondFiles = [...beyond.values()].flatMap((one) => one.files);
  const { whole, ...rest } = await restingOf(here, suite, relations, [...new Set([...changed, ...stands.flatMap((s) => s.changed), ...beyondFiles])]);
  // What the install changed whole is named whichever way the answer goes: a test it entered was entered by no line.
  const install = installReached(installs, beyond, (stand) =>
    handed ? 'before the patch' : `${ranOver.has(stand) ? 'the install recorded ' : ''}at ${(stand ?? commit)?.slice(0, 12) ?? base}`,
  );
  const notes = unkept.size === 0 ? {} : { standing: [...(recorded.standing ?? []), ...unkept] };
  const rested = { ...recorded, ...notes, ...rest, ...(install === undefined ? {} : { install }) };
  if (whole !== undefined) return said({ ...rested, ground: { kind: 'before', whole } });
  // Each group is charged the install that moved since it ran, and the files
  // a stand reads whole leave the hunk diff, so none is also read by its hunks.
  // What changed between a stand and the journal's commit is the diff between
  // the two commits, read from both texts like the tree's. Its new side is the
  // stand, never the tree, so a module the landing kept a text for is charged
  // whole there: the kept text is not what the tree holds.
  const options = { relations, at, checkout: request.root, unmeasured: selection.unmeasuredOf(declared), distances: request.atDistance !== undefined };
  const ask = (question: StandQuestion) =>
    question.read === 'stand'
      ? recordAgainst(here, selection.standDiff(gitIn(here), commit!, question.at), { ...options, keptTexts: false })
      : recordAgainst(
          here,
          withWhole(
            [selection.withoutFiles(diff, question.whole), ...question.whole.map(selection.wholeEntry)].join('\n'),
            beyond.get(question.at)!.files,
          ),
          handed ? { ...options, undone: false } : options,
        );
  const asked = stands.length === 0 ? await ask({ read: 'tree', at: undefined, whole: [] }) : await recordPerStand(stands, ask);
  const narrowing: ExecutionNarrowing | undefined = asked?.narrowing;
  // The lockfile and the manifests beside it are unread by the journal and
  // answered by the comparisons above, which have already said what moved.
  const manifests = [...installs.values()].flatMap((installed) => compared(installed)?.manifests ?? []);
  const unplaced = [...beyond.values()].flatMap((one) => one.unplaced);
  const ground: SelectGround =
    narrowing === undefined
      ? { kind: 'no-journal' }
      : {
          kind: 'read',
          ...(request.atDistance === undefined || asked?.distances === undefined ? {} : { distances: asked.distances }),
          narrowing: {
            ...narrowing,
            unread: [...new Set([...withoutManifests(narrowing.unread, manifests), ...unplaced])].sort(),
          },
        };

  return said({ ...rested, ground });
}

/**
 * Where each test in the journal at `at` last ran, as the runs recorded beside
 * it say, with the files changed since each stand named from the top of
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
  const reading = selection.standsAt(at, runs, gitIn(repository), (test) => existsSync(join(repository, test)));
  return reading === undefined ? undefined : { reading, stands: reading.stands };
}

/** One git invocation in `repository`, answering its stdout. */
const gitIn =
  (repository: string) =>
  (...args: string[]): string =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** What the journal says about where its tests last ran, as notes after the verdict. */
function standingNotes(reading: StandReading, commit: string): readonly string[] {
  const notes = reading.stands.map(
    (stand) =>
      `${many(stand.tests.length, 'test file')} last ran at ${stand.commit.slice(0, 12)}, before the journal's commit ` +
      `${commit.slice(0, 12)}, so the ${many(stand.changed.length, 'file')} changed between the two ` +
      `${stand.changed.length === 1 ? 'is' : 'are'} read from both texts for ${stand.tests.length === 1 ? 'it' : 'them'}`,
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
 * The record of the suite this checkout measures from, in the order `suiteBase` gives every base
 * reader: this checkout's own, else the mainline's (ADR-0084), else, in a worktree, the primary
 * checkout's as the offline fallback.
 *
 * A suite the root config does not give to a share has no mainline record, and reads the nearest
 * layer that holds one. For a suite given to a share the first note after the verdict says whose
 * record it read, because they select differently and a skip list alone does not say which.
 */
async function recordedOrMainline(
  request: SuiteRequest,
): Promise<{ readonly at: string; readonly held: boolean; readonly source?: SelectSource }> {
  const recorded = await recordedSuite(request.root, request.suite);
  const suite = recorded.declared?.carry === 'share' ? recorded.declared.name : undefined;
  if (suite === undefined) return { at: recorded.file, held: await exists(recorded.file) };
  const base = await suiteBase(request.root, { suite });
  if (base.from === 'own') return { at: base.file, held: true, source: { from: 'checkout', says: await checkoutRead(suite, request.root, base) } };
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
