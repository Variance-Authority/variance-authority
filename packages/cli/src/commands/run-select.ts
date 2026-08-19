/**
 * Everything `--since` has to go and fetch before anything can be ruled out.
 *
 * The decision itself is a pure function next door in [`affected.ts`](./affected.ts),
 * and this is the half with a store, a disk and a subprocess in it. Splitting
 * them is what makes the rules assertable without a repository, a browser or a
 * baseline — and it keeps every input to the narrowing visible in one place,
 * which matters more here than anywhere else in the run: a missing input does
 * not fail, it silently rules out subjects nobody then looks at.
 */

import type { SourceIndex } from '@variance-authority/core';
import { OperatorError } from '../exit.js';
import { affectedSubjects } from './affected.js';
import type { Plan } from './collector.js';
import type { ObserveContext, RunOptions } from './run-context.js';

export interface Selection {
  readonly skipped: ReadonlyMap<string, string>;
  readonly whole?: string;

  /**
   * The index the narrowing was computed from, handed on rather than rebuilt.
   *
   * The composition phase needs the same map — component name to the file that
   * declares it — to say whether anybody edited what moved, and scanning the
   * source tree twice for one answer is a disk walk nobody asked for.
   */
  readonly source: SourceIndex;
}

/**
 * What `--since` ruled out, or `undefined` when nothing asked it to.
 *
 * Every input it needs is fetched here and the decision itself is a pure
 * function next door, which is what makes the rules in `affected.ts` assertable
 * without a repository, a store or a browser.
 *
 * **It refuses rather than guesses.** A `--since` with no `source.dirs` in the
 * config cannot know where components are declared, and narrowing on an empty
 * index would rule out the entire suite. That is an operator error and is raised
 * as one; the alternative is a green run over nothing.
 */
export async function selectionFor(
  plan: Plan,
  context: ObserveContext,
  options: RunOptions,
): Promise<Selection | undefined> {
  const { config, deps, renderer } = context;
  if (options.since === undefined) return undefined;

  const scan = deps.scanSource;
  if (config.source === undefined || scan === undefined) {
    throw new OperatorError(
      '`--since` narrows a run to the subjects a diff could have changed, and needs to know ' +
        'where your components are declared. Add `source: { dirs: [...] }` to the config. ' +
        'Narrowing without it would rule out every subject in the suite.',
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
      ? await deps.changedProjects(options.since.ref)
      : undefined;

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
