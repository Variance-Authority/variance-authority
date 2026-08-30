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
 */

import type { SourceIndex } from '@variance-authority/core';
import type { ReachReport } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
import { affectedSubjects } from './affected.js';
import type { Plan } from './collector.js';
import { reachOf } from './reach.js';
import type { ObserveContext, RunOptions } from './run-context.js';

export interface Selection {
  readonly skipped: ReadonlyMap<string, string>;
  readonly whole?: string;

  /**
   * The files the diff named, whichever flag asked for them.
   *
   * Carried here because the union of the two flags belongs in one place. The
   * composition phase used to compute its own, read `--since` alone, and so
   * handed the movement ladder nothing on an `--against` run — a run that had
   * walked the diff, written `reach` into the report, and then attributed every
   * movement in it to nothing under a sentence asking for the diff it had.
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
  const diff = options.since ?? options.against;
  if (diff === undefined) return undefined;

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

  const changedDirs =
    config.source.changes !== undefined && deps.changedProjects !== undefined
      ? await deps.changedProjects(diff.ref)
      : undefined;

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
          against: diff.ref,
          changed: diff.changed,
          relations,
          roots: config.source.dirs,
          baselines,
          ...(changedDirs === undefined ? {} : { changedDirs }),
        });

  if (options.since === undefined) {
    return {
      source,
      changed: diff.changed,
      skipped: new Map(),
      ...(reach === undefined ? {} : { reach }),
    };
  }

  const answer = affectedSubjects({
    planned: plan.subjects.map((planned) => planned.subject.id),
    changed: options.since.changed,
    source,
    roots: config.source.dirs,
    baselines,
    ...(relations === undefined ? {} : { relations }),
    ...(changedDirs === undefined ? {} : { changedDirs }),
  });

  return {
    source,
    changed: diff.changed,
    ...(reach === undefined ? {} : { reach }),
    skipped: new Map(
      answer.skipped.map((entry) => [
        entry.subject,
        `not affected by the diff against ${options.since?.ref ?? 'the ref'}: ${entry.because}`,
      ]),
    ),
    ...(answer.whole !== undefined
      ? { whole: `\`--since ${options.since.ref}\` did not narrow this run: ${answer.whole}` }
      : {}),
  };
}
