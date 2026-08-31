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

import type { SourceIndex } from '@variance-authority/core';
import type { ReachReport } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
import { affectedSubjects } from './affected.js';
import type { Plan } from './collector.js';
import { unenteredSubjects } from './journey.js';
import { many, reachOf } from './reach.js';
import type { ObserveContext, RunOptions } from './run-context.js';

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
      { subject: planned.subject.id },
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
          ...(changedDirs === undefined ? {} : { changedDirs }),
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
    ...(relations === undefined ? {} : { relations }),
    ...(config.source.unrendered === undefined ? {} : { unrendered: config.source.unrendered }),
    ...(narrowDirs === undefined ? {} : { changedDirs: narrowDirs }),
  });

  // Only what survived the structural ground. A journal recorded before a
  // subject existed must not be allowed to rule out a subject the diff plainly
  // reaches, and the two grounds only ever remove.
  const surviving = planned.filter(
    (subject) => !answer.skipped.some((entry) => entry.subject === subject),
  );

  // Absent all the way down: no diff text, no reader, or a reader that found no
  // snapshot. Each of those is *the journal was not consulted*, which narrows
  // nothing and is not an error — the probes are a build the operator opts into.
  const journal = diff === undefined ? undefined : await deps.readJourney?.(diff);
  const journey =
    journal === undefined
      ? undefined
      : unenteredSubjects({
          planned: surviving,
          whole: journal.whole,
          entered: journal.entered,
          unread: journal.unread,
        });

  const because = (entry: { readonly because: string }): string =>
    `not affected by the diff against ${ref}: ${entry.because}`;

  return {
    source,
    changed: explains.changed,
    ...(reach === undefined ? {} : { reach }),
    skipped: new Map([
      ...answer.skipped.map((entry): [string, string] => [entry.subject, because(entry)]),
      ...(journey?.skipped ?? []).map((entry): [string, string] => [entry.subject, because(entry)]),
    ]),
    notes: notesFor(ref, answer, journey),
  };
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
    readonly whole?: string;
    readonly unwatched?: readonly string[];
  },
  journey: { readonly skipped: readonly unknown[]; readonly whole?: string } | undefined,
): readonly string[] {
  const ruled = answer.skipped.length + (journey?.skipped.length ?? 0);
  const unwatched = answer.unwatched ?? [];

  return [
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
    ...(journey?.whole === undefined
      ? []
      : [`\`--since ${ref}\` was not narrowed by execution: ${journey.whole}`]),
    ...(ruled === 0
      ? []
      : [
          `\`--since ${ref}\` ruled out ${many(ruled, 'subject')}: ` +
            `${answer.skipped.length} by what the diff declares and reaches, ` +
            `${journey?.skipped.length ?? 0} by what the last run recorded entering.`,
        ]),
  ];
}
