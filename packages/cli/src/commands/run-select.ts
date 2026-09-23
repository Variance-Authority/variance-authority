/**
 * Everything the diff has to go and fetch before anything can be ruled out — or
 * explained.
 *
 * The decisions themselves are pure functions next door: what to skip in
 * [`affected.ts`](./affected.ts), what the commit reaches in
 * [`reach.ts`](./reach.ts). This is the half with a store, a disk and a
 * subprocess in it. Splitting them is what makes the rules assertable without a
 * repository, a browser or a baseline — and it keeps every input to the
 * narrowing visible in one place, which matters more here than anywhere else in
 * the run: a missing input does not fail, it silently rules out subjects nobody
 * then looks at.
 *
 * ## Two flags, one gathering
 *
 * `--since` narrows and `--against` explains, and they need exactly the same
 * three things: the paths git named, the file graph, and the component list each
 * baseline recorded when it was painted. Fetching that twice would be two disk
 * walks for one answer, and — worse — would let the sentence a run prints about a
 * subject disagree with the reason it skipped one.
 *
 * ## Two grounds under `--since`, and the second one needs the diff itself
 *
 * The paths are enough to ask what a commit *could* have moved. They are not
 * enough to ask what it moved *at the line*, and that is the question the
 * execution journal answers — see [`journey.ts`](./journey.ts). It reads hunk
 * ranges, so `--since` fetches the diff text beside the file list when a journal
 * is there to read it against.
 */

import type { SourceIndex } from '@variance-authority/core/attribute';
import {
  beforeReach,
  within,
  type BeforeReach,
  type Relations,
} from '@variance-authority/core/relate';
import type { ExecutionNarrowing } from '@variance-authority/sense/test-selection';
import type { ReachReport } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
import { affectedSubjects, type Affected } from './affected.js';
import { keyFor, type Plan } from './collector.js';
import { unenteredSubjects } from './journey.js';
import { many, movedPackages, withMovedPackages, withoutManifests, type InstallDiff } from './reach.js';
import { reachOf } from './reach-subjects.js';
import type { ObserveContext, RunDeps, RunOptions } from './run-context.js';

export interface Selection {
  readonly skipped: ReadonlyMap<string, string>;

  /**
   * What the run should say out loud about the narrowing itself.
   *
   * One entry per ground that declined to rule anything out, plus the tally when
   * one of them did. *We could not narrow* and *nothing needed narrowing*
   * produce the same run and mean opposite things about the next one, and with
   * two grounds there are two ways to be in either state — so which ground was
   * consulted, and what each of them concluded, is printed rather than inferred
   * from a count of subjects.
   */
  readonly notes: readonly string[];

  /**
   * The files the explaining diff named, resolved once for every phase that
   * needs them.
   *
   * The composition phase used to compute its own and read `--since` alone, so
   * an `--against` run — one that had walked the diff and written `reach` into
   * the report — handed the movement ladder nothing, and every movement in it
   * fell past the two rungs that read a change set.
   *
   * This is `--against`'s set when `--against` was asked for, because the
   * ladder's question is *what did this commit change*, which is the question
   * that flag asks. `--since` stands in when it is the only one given.
   */
  readonly changed: readonly string[];

  /**
   * The index the narrowing was computed from, handed on rather than rebuilt.
   *
   * The composition phase needs the same map — component name to the file that
   * declares it — to say whether anybody edited what moved, and scanning the
   * source tree twice for one answer is a disk walk nobody asked for.
   */
  readonly source: SourceIndex;

  /**
   * What the commit reaches, when `--against` asked and a graph could answer.
   *
   * Absent under `--since` alone with no file graph configured: the
   * declaration-only selector can name the components a diff touched but not the
   * chain that carried it, and a reach section without trails is a list of names
   * a reviewer cannot check.
   */
  readonly reach?: ReachReport;
}

/**
 * What the diff ruled out and what it reaches, or `undefined` when nothing asked
 * for either.
 *
 * **It refuses rather than guesses.** A `--since` with no `source.dirs` in the
 * config cannot know where components are declared, and narrowing on an empty
 * index would rule out the entire suite. That is an operator error and is raised
 * as one; the alternative is a green run over nothing. `--against` refuses on the
 * same ground and one more: with no file graph there are no chains, and a section
 * that named components without saying how they were reached would be an
 * assertion a reviewer has no way to check.
 */
export async function selectionFor(
  plan: Plan,
  context: ObserveContext,
  options: RunOptions,
): Promise<Selection | undefined> {
  const { config, deps, renderer } = context;

  // Two flags, two questions, and given both they are two refs. `--since` asks
  // which subjects are worth running; `--against` asks what to blame when one of
  // them moves. Collapsing them to a precedence dropped the `--against` ref
  // without a word, and the report then said it had explained the run against
  // the ref it had narrowed by.
  const explains = options.against ?? options.since;
  if (explains === undefined) return undefined;

  const asked = options.since === undefined ? '`--against`' : '`--since`';
  const scan = deps.scanSource;
  if (config.source === undefined || scan === undefined) {
    throw new OperatorError(
      `${asked} reads a run against a diff, and needs to know where your components are ` +
        'declared. Add `source: { dirs: [...] }` to the config. Narrowing without it would rule ' +
        'out every subject in the suite.',
    );
  }

  // The component list a baseline recorded, read from the sidecar without the
  // image: this is `describe`'s whole reason to exist, and selection is the
  // second caller that would otherwise have paid a megabyte per subject to ask a
  // question about names.
  const baselines = new Map<string, readonly string[] | undefined>();
  for (const planned of plan.subjects) {
    const described = await deps.store.describe(
      keyFor(planned),
      renderer.identityFor({ viewport: planned.viewport ?? config.viewport }),
    );
    baselines.set(planned.subject.id, described?.components);
  }

  const source = await scan(config.source.dirs);

  // Both are optional and both only ever *add*: the graph turns "a changed file
  // declaring nothing" from a whole run into an exact answer, and the monorepo
  // tool contributes the dependencies the scan cannot see because they run
  // through built output. Neither can rule anything out on its own.
  const relations =
    config.source.relations === true && deps.scanRelations !== undefined
      ? await deps.scanRelations(config.source.dirs)
      : undefined;

  // What the run rests on before any test imports it, walked once. Computed
  // here rather than inside either caller for the reason the graph is: the
  // selector and the report must refuse for the same reason, and two walks
  // would let one of them refuse while the other explained.
  const before =
    relations === undefined || config.source.before === undefined
      ? undefined
      : beforeReach(relations, config.source.before, { sensed: config.source.dirs });

  const dirsFor = async (ref: string): Promise<readonly string[] | undefined> =>
    config.source?.changes !== undefined && deps.changedProjects !== undefined
      ? await deps.changedProjects(ref)
      : undefined;

  const changedDirs = await dirsFor(explains.ref);
  // The same call again only when the two flags name two different revisions —
  // which projects a diff touched is a question about a ref, and answering it
  // for the wrong one narrows the suite by a diff nobody asked to narrow by.
  const narrowDirs =
    options.since === undefined || options.since.ref === explains.ref
      ? changedDirs
      : await dirsFor(options.since.ref);

  if (options.against !== undefined && relations === undefined) {
    throw new OperatorError(
      '`--against` explains a run by the chain from a changed file to a component, and needs a ' +
        'file graph to walk. Add `source: { relations: true }` to the config. Without it the ' +
        'run could name components the diff touched but not how it reached them, which is a ' +
        'claim nobody reading the report could check.',
    );
  }

  // Computed from `diff`, so `--since` gets the explanation for free when a graph
  // is configured: the walk has already happened, and the only difference between
  // the two flags is what the caller does with it.
  const reach =
    relations === undefined
      ? undefined
      : reachOf({
          against: explains.ref,
          changed: explains.changed,
          relations,
          roots: config.source.dirs,
          baselines,
          ...(before === undefined ? {} : { before }),
          ...(changedDirs === undefined ? {} : { changedDirs }),
          ...(explains.install === undefined ? {} : { install: explains.install }),
        });

  if (options.since === undefined) {
    return {
      source,
      changed: explains.changed,
      skipped: new Map(),
      notes: [],
      ...(reach === undefined ? {} : { reach }),
    };
  }

  const { ref, diff } = options.since;
  const planned = plan.subjects.map((each) => each.subject.id);

  const answer = affectedSubjects({
    planned,
    changed: options.since.changed,
    source,
    roots: config.source.dirs,
    baselines,
    ...(before === undefined ? {} : { before }),
    ...(relations === undefined ? {} : { relations }),
    ...(config.source.unrendered === undefined ? {} : { unrendered: config.source.unrendered }),
    ...(narrowDirs === undefined ? {} : { changedDirs: narrowDirs }),
    ...(options.since.install === undefined ? {} : { install: options.since.install }),
  });

  // Absent all the way down: no diff text, no reader, or a reader that found no
  // snapshot. Each of those is *the journal was not consulted*, which narrows
  // nothing and is not an error — the probes are a build the operator opts into.
  // So is a structural refusal over evidence the journal does not hold, which
  // the note above the tally has already named.
  const install = options.since.install;
  const compared = install === undefined || 'whole' in install ? undefined : install;
  const journal =
    diff === undefined || beyondTheJournal(install, answer)
      ? undefined
      : await journalOf(deps, diff, relations, compared, config.source.dirs);

  // A structural skip the recording contradicts is not proven. That ground reads
  // the components a baseline names and the edges the graph could read, and
  // leaves what neither holds to the execution record — so a subject recorded
  // entering the changed lines is observed. The journal keeps what the structural
  // ground removed; it never removes it a second time.
  const entered = new Set(journal?.entered ?? []);
  const kept = answer.skipped.filter((entry) => entered.has(entry.subject)).map((entry) => entry.subject);
  const skipped = answer.skipped.filter((entry) => !entered.has(entry.subject));

  // Only what survived the structural ground. A journal recorded before a
  // subject existed must not be allowed to rule out a subject the diff plainly
  // reaches, so it reads these and nothing the structural ground removed.
  const surviving = planned.filter((subject) => !skipped.some((entry) => entry.subject === subject));
  const journey =
    journal === undefined
      ? undefined
      : unenteredSubjects({ planned: surviving, whole: journal.whole, entered: journal.entered });

  const because = (entry: { readonly because: string }): string =>
    `not affected by the diff against ${ref}: ${entry.because}`;

  return {
    source,
    changed: explains.changed,
    ...(reach === undefined ? {} : { reach }),
    skipped: new Map([
      ...skipped.map((entry): [string, string] => [entry.subject, because(entry)]),
      ...(journey?.skipped ?? []).map((entry): [string, string] => [entry.subject, because(entry)]),
    ]),
    notes: notesFor(
      ref,
      { ...answer, skipped, kept },
      journey,
      {
        unread: journal?.unread ?? [],
        stale: journal?.stale ?? [],
      },
      before,
    ),
  };
}

/**
 * Whether the structural ground refused for a reason the journal cannot
 * overrule.
 *
 * Two of its refusals are about evidence the journal never had. An install that
 * could not be compared may have moved any package, and no line of the diff
 * shows it. A diff that moves what the run rests on — `source.before` — moves a
 * file nothing imports, which the journal holds no row for and so answers with
 * nobody. A journal consulted after either would rule out every subject the
 * structural ground had just kept, over a change it never saw.
 *
 * Both are carried: the install is the reading the structural ground was
 * handed, and the `before` files are the ones its walk refused on.
 */
function beyondTheJournal(install: InstallDiff | undefined, answer: Affected): boolean {
  return (install !== undefined && 'whole' in install) || (answer.rests ?? []).length > 0;
}

/**
 * The journal's reading of the diff, given the file graph whenever it needs one.
 *
 * A changed file no probe can sit in — a stylesheet — is answered by the
 * modules that import it, and a reader with no graph leaves it `unread`, where
 * it keeps no subject. The structural ground kept every subject because it could
 * not place that same file, so a journal read without the graph would rule out
 * every subject that renders it. The structural ground takes the graph only when
 * `source.relations` asks; this ground scans for one itself, when a first
 * reading left a path under `source.dirs` unread — a README outside them is not
 * in any graph the scan could build.
 *
 * A bumped package is answered by its importers as well, so a reading that
 * carries one is handed a graph from the start. With no scanner to build one the
 * journal is not consulted at all: it would hear nothing of the bump, and the
 * structural ground has already said it could not place it.
 */
async function journalOf(
  deps: RunDeps,
  diff: string,
  relations: Relations | undefined,
  install: Extract<InstallDiff, { readonly moved: unknown }> | undefined,
  dirs: readonly string[],
): Promise<ExecutionNarrowing | undefined> {
  const packages = install?.packages ?? [];
  const read = async (graph?: Relations) => {
    // A package whose manifest moved is every file of it, changed whole, and
    // only the graph can say which files those are.
    const moved = graph === undefined ? { files: [], unplaced: [] } : movedPackages(graph, install);
    const narrowing = await deps.readJourney?.(withMovedPackages(diff, moved.files), graph, packages);
    // The lockfile and the manifests beside it are unread by the journal and
    // answered by the install comparison, which has already said what moved.
    return narrowing === undefined
      ? undefined
      : { ...narrowing, unread: [...withoutManifests(narrowing.unread, install?.manifests ?? []), ...moved.unplaced].sort() };
  };
  if (relations !== undefined) return read(relations);
  const needsGraph = packages.length > 0 || (install?.moved.length ?? 0) > 0;
  if (deps.scanRelations === undefined) return needsGraph ? undefined : read();
  if (needsGraph) return read(await deps.scanRelations(dirs));
  const first = await read();
  if (first === undefined || !first.unread.some((path) => within(path, dirs))) return first;
  return read(await deps.scanRelations(dirs));
}

/**
 * What the run prints about its own narrowing.
 *
 * The tally names both grounds and prints a zero for either of them, because the
 * interesting number is the one that is zero: a journal that ruled out nothing
 * over a diff the file graph could not narrow is a build with no probes in it,
 * and a line reading *`0` by what they entered* is the only thing on the page
 * that says so.
 *
 * The other zero is the whole suite, and it gets a line of its own. A run that
 * ruled out every subject because the diff reached components no baseline
 * records has either found a corner nobody watches or gone blind to a server
 * component, and the two are one shape from inside the selector — so the names it
 * could not match are printed rather than left to be inferred from an empty
 * report.
 */
function notesFor(
  ref: string,
  answer: {
    readonly skipped: readonly unknown[];
    readonly kept: readonly string[];
    readonly whole?: string;
    readonly unwatched?: readonly string[];
  },
  journey: { readonly skipped: readonly unknown[]; readonly whole?: string } | undefined,
  journal: { readonly unread: readonly string[]; readonly stale: readonly string[] },
  before: BeforeReach | undefined,
): readonly string[] {
  const ruled = answer.skipped.length + (journey?.skipped.length ?? 0);
  const { kept } = answer;
  // Every subject ruled out is no longer true once the recording kept one.
  const unwatched = kept.length === 0 ? (answer.unwatched ?? []) : [];
  const { stale } = journal;
  const unentered = journal.unread;

  const unread = before?.unread ?? [];

  return [
    ...(unread.length === 0
      ? []
      : [
          `\`source.before\` names ${many(unread.length, 'file')} the scan does not hold ` +
            `(${unread.slice(0, 3).join(', ')}${unread.length > 3 ? ', …' : ''}), so ` +
            `${unread.length === 1 ? 'it covers its own path' : 'each covers its own path'} and ` +
            'nothing below it. That is the whole answer for a `.nvmrc` or a CI workflow, which ' +
            'have nothing under them to read; for a harness config it means the setup files it ' +
            'loads are still narrowing to nothing.',
        ]),
    ...(answer.whole === undefined
      ? []
      : [`\`--since ${ref}\` did not narrow this run: ${answer.whole}`]),
    ...(unwatched.length === 0
      ? []
      : [
          `\`--since ${ref}\` ruled out every subject: it reaches ${many(unwatched.length, 'component')} ` +
            `no baseline records (${unwatched.slice(0, 3).join(', ')}${unwatched.length > 3 ? ', …' : ''}) — ` +
            'either nothing here watches that surface, or something here paints it without ' +
            'recording it, which is what a server component always does. `source.unrendered: ' +
            '"whole"` is the second.',
        ]),
    ...(kept.length === 0
      ? []
      : [
          `\`--since ${ref}\` kept ${many(kept.length, 'subject')} the diff ruled out: the last run ` +
            `recorded ${kept.length === 1 ? 'it' : 'them'} entering the changed lines ` +
            `(${kept.slice(0, 3).join(', ')}${kept.length > 3 ? ', …' : ''}).`,
        ]),
    ...(journey?.whole === undefined
      ? []
      : [`\`--since ${ref}\` was not narrowed by execution: ${journey.whole}`]),
    ...(unentered.length === 0
      ? []
      : [
          `the execution journal records nothing about ${many(unentered.length, 'changed file')} ` +
            `(${unentered.slice(0, 3).join(', ')}${unentered.length > 3 ? ', …' : ''}), so ` +
            `${unentered.length === 1 ? 'it kept' : 'they kept'} no subject in the run.`,
        ]),
    ...(stale.length === 0
      ? []
      : [
          `the recording was not cut from the text ${many(stale.length, 'changed file')} ` +
            `${stale.length === 1 ? 'has' : 'have'} at the commit it names ` +
            `(${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ', …' : ''}), so ` +
            `${stale.length === 1 ? 'its line numbers mean' : 'their line numbers mean'} ` +
            'something else here and every subject that covered ' +
            `${stale.length === 1 ? 'it' : 'them'} is kept. Record once over a clean tree to narrow ` +
            'by region again.',
        ]),
    ...(ruled === 0
      ? []
      : [
          `\`--since ${ref}\` ruled out ${many(ruled, 'subject')}: ` +
            `${answer.skipped.length} by what the diff declares and reaches, ` +
            `${journey?.skipped.length ?? 0} by what the last run recorded as covered.`,
        ]),
  ];
}
