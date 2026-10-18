// compass: variance-authority.acquisition

import { pathToFileURL } from 'node:url';
import type { CallSiteResolver, SourceIndex } from '@variance-authority/core/attribute';
import {
  realizes,
  type Diagnostic,
  type RenderDocument,
  type SemanticSnapshot,
  type Step,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core/format';
import { storySubjectId, toSubjects } from '@variance-authority/storybook';
import { readStoryIndex } from '@variance-authority/storybook/read';
import type { BaselineKey } from '@variance-authority/raster';
import type { PresentationSignalRecord } from '@variance-authority/report';
import type { Config, SubjectsConfig } from '../config.js';
import { OperatorError } from '../exit.js';
import type { NotObserved } from './run-report.js';

/**
 * What a run is asked to observe, and where the documents come from.
 *
 * The line this file draws is the one the whole tool is organised around: the
 * *subject list* is generic and the *documents* are not. A story index is a file
 * with a documented shape, so planning happens here where it can be tested with
 * no browser. Mounting a project's components, waiting for them to be ready, and
 * serializing the result needs the project's own bundle, its own providers, and
 * its own definition of settled — so it is a module the operator writes and this
 * one imports.
 *
 * Everything here runs before a pixel is paid for, which is why `--subjects` also
 * lives in this file: filtering the plan is a statement about which subjects were
 * asked for, not about what any of them looked like.
 */

/**
 * A subject the run intends to observe.
 *
 * One image per subject, deliberately. `BaselineKey` carries a `label` so that a
 * subject can have several images, and this command does not use it: observations
 * in a run report are keyed by subject id, so two records sharing an id would
 * make `variance_describe` ambiguous about which image it is describing, and
 * `accept <subject>` ambiguous about which one it promotes. A subject observed at
 * two viewports is two subjects, with two ids the operator chose.
 */
export interface PlannedSubject {
  readonly subject: SubjectRef;
  /** Overrides the run's viewport, when the subject declared its own. */
  readonly viewport?: Viewport;

  /**
   * What the subject declares itself to be, from the artifact that produced it.
   *
   * Storybook's built index carries `tags` and does not carry a story's
   * `parameters`, so a tag is the only per-story declaration that survives a
   * build — and it is the right one anyway: what a subject *is* belongs in its
   * own name, next to it, rather than in a central file repeating every id.
   *
   * Selection lives here; definition lives in the config. A tag is a word a
   * story wears, and what that word *means* is the operator's to write down
   * once, where a typo can be refused by name.
   */
  readonly tags?: readonly string[];

  /**
   * Where the subject sits in its file's own hierarchy, `/`-separated: a
   * story's `title`. Absent when the plan knows none.
   *
   * With {@link name} and {@link declaredIn}, what a baseline is named after,
   * and they travel one way: the artifact that produced the plan knows them —
   * Storybook's index names a title, a name and an `importPath` per story — and
   * nothing downstream can recover them, because a subject id is a namespaced
   * name and not a path.
   */
  readonly title?: string;

  /** The subject's own name under its title: a story's `name`. */
  readonly name?: string;

  /**
   * The file that declares this subject, relative to the repository, when the
   * plan knows one.
   *
   * What a baseline path template's `{dir}` and `{file}` render, so the image
   * lands in the same directory, the same review and the same `git mv` as the
   * code it is an image of.
   *
   * What `--shard` keeps together: every story of one CSF file, every width of
   * one route, lands on the same shard and the same worker, because they share
   * a module graph that the first of them pays to load. Absent means the
   * subject is its own group — no file is invented for it.
   */
  readonly declaredIn?: string;
}

export interface Plan {
  readonly subjects: readonly PlannedSubject[];
  /** Subjects the plan itself refuses. Reported, never dropped. */
  readonly notObserved: readonly NotObserved[];
  readonly warnings: readonly string[];
}

/**
 * Everything the cheap tiers produced for one subject, or the reason there is
 * nothing.
 *
 * `ok: false` is not an exception. One subject that cannot be mounted must not
 * cost the other 299 their observations, and it must not be silently absent
 * either — so it travels as a value with a sentence attached.
 */
export type Collected =
  | {
      readonly ok: true;
      readonly document: RenderDocument;
      /**
       * The other side, for an ephemeral comparison.
       *
       * Ephemeral retention renders both images in one run so the machine cancels
       * out by construction (ADR-0011). That requires the collector to be able to
       * produce the previous revision's document, which is a thing only the
       * project knows how to do.
       */
      readonly before?: RenderDocument;
      /** The normalized snapshot of the same render; without it regions have no names. */
      readonly snapshot?: SemanticSnapshot;

      /**
       * Stabilization tricks the collector applied before reading this subject.
       *
       * Reported by a run so it can state what it did to the page — the one
       * alteration this tool makes to somebody else's application, and therefore
       * the one contract 2 most obviously covers. A collector that supplies
       * nothing here is saying it did not stabilize, which is a real answer:
       * the Playwright fixture stabilizes too, and a hand-written collector may
       * not.
       */
      readonly stabilization?: readonly string[];

      /**
       * What the collector noticed about the *way* it read this subject.
       *
       * Not about the picture — the document and the snapshot carry that — but
       * about the reading: a Storybook story that finished by reporting it
       * failed, a preview that had to be reloaded to show it. Each leaves a real
       * image a run can compare, and each changes what a person should conclude
       * from a green verdict, so a run carries them into the subject's record
       * beside the diagnostics the document raised itself.
       */
      readonly diagnostics?: readonly Diagnostic[];
      /**
       * Components the semantic tier named as *roots* of the change.
       *
       * Passed to `rankRegions`, which is the difference between a report led by
       * the edit and one led by whatever the edit pushed around. Absent means the
       * ordering falls back to area, which that function documents as honest and
       * not good.
       */
      readonly causes?: readonly string[];
      readonly source?: SourceIndex;
      /** Product-owned presentation consequence, already compared by the collector. */
      readonly presentation?: PresentationSignalRecord;
      /**
       * How long each step of this reading took, in the order they ran, on the
       * collector's own clock. The run records them as `collect.<step>` beside
       * its own; absent records none.
       */
      readonly steps?: readonly Step[];
    }
  | {
      readonly ok: false;
      /**
       * The subject left the run by its own decision, which a collector learns
       * only once it reads it — a page that marks itself excluded. The run
       * records it as `excluded`, beside the subjects the plan left out, and
       * does not send the run to review for it. Absent is a failure.
       */
      readonly excluded?: true;
      readonly because: string;
    };

/** One subject a visit read: the subject as it was realized, and its reading. */
export interface VisitedSubject {
  readonly planned: PlannedSubject;
  readonly collected: Collected;
}

/**
 * What reaching one planned subject produced, when it is not one reading.
 *
 * A plan is made before any subject is visited, and some of what decides how a
 * subject is read is known only at the visit: a story's widths live in its
 * parameters, which are read when its file is loaded. So a visit may realize
 * several subjects, or the planned one at a viewport it declared, and say what
 * it could not read on the way. Every realized id is the planned id or the
 * planned id at a width, `<id>@<digits>`, so a `--subjects` glob decides before
 * the visit whether anything it realizes can be wanted. A visit that realizes
 * any other id fails its story.
 */
export interface Visit {
  readonly subjects: readonly VisitedSubject[];
  readonly warnings?: readonly string[];
  /**
   * Present when the visit could not learn every subject the planned one
   * realizes — a story whose parameters were not read, so its widths are
   * unknown. The run then treats what the store holds of the planned subject
   * as it does for a subject it did not visit: planned, not left behind.
   */
  readonly incomplete?: true;
}

/**
 * The subjects one `collect` produced, as a list whichever shape it answered in.
 * A visit that realized nothing is the planned subject failed: the plan holds
 * it, so the report says what became of it. So is a visit that realized an id
 * outside {@link Visit}'s contract: the run cannot trust any of it.
 */
export function visited(planned: PlannedSubject, result: Collected | Visit): readonly VisitedSubject[] {
  if (!('subjects' in result)) return [{ planned, collected: result }];
  const id = planned.subject.id;
  const stray = result.subjects.find((entry) => !realizes(id, entry.planned.subject.id))?.planned.subject.id;
  const because = `the collector realized \`${stray}\`, which is neither \`${id}\` nor one of its widths`;
  if (stray !== undefined) return [{ planned, collected: { ok: false, because } }];
  if (result.subjects.length > 0) return result.subjects;
  return [{ planned, collected: { ok: false, because: 'the collector visited it and realized no subject' } }];
}

/**
 * The half of a run this package cannot write.
 *
 * A story index is a file with a documented shape, so planning is generic.
 * Mounting a project's components, waiting for them to be ready, and serializing
 * the result is not: it needs the project's own bundle, its own providers, and
 * its own definition of settled. Every tool that has claimed otherwise grew a
 * plugin system whose failures are undebuggable from either side.
 *
 * So the config names a module, this CLI imports it, and the contract is the
 * three methods below. In exchange, nothing in this file has to guess what a
 * subject is.
 *
 * **What it costs the operator, measured rather than estimated, twice.** This
 * comment said "about thirty lines" until one was written, and then said 341 —
 * `cases/storybook-case/collector/`, three files, 234 of them in the module the
 * config names. The estimate had been optimistic by 8×.
 *
 * Both numbers are now historical for Storybook specifically.
 * `@variance-authority/storybook-collector` ships that half, and the same case
 * is **five lines of code** against the same end-to-end test. What the 341
 * measured, in hindsight, was one boundary drawn in the wrong place: a story
 * index is a documented artifact and a preview owns its own mount, so nothing in
 * those lines was knowledge only that project held except a ready selector and a
 * source directory.
 *
 * The contract below is unchanged and is still the answer for everything else —
 * a route table, a bespoke mount, a suite this repository has never seen. What a
 * reader comparing this against a vendor's SDK should be given is both figures:
 * five lines where a shipped collector exists, and 341 where one does not.
 */
export interface Collector {
  /** Subjects to observe, plus the ones this source already refuses, with reasons. */
  plan(): Promise<Plan>;
  /** One planned subject read: a {@link Collected}, or a {@link Visit} when it realized other subjects. */
  collect(subject: PlannedSubject): Promise<Collected | Visit>;

  /**
   * The frames a snapshot carries, spent on demand.
   *
   * Present when the collector drives a browser, because resolving a frame means
   * fetching the module it names and the page is the only place that request is
   * already correct. Absent otherwise, and absence is not a degradation: it means
   * either that nothing captured frames, or that the run has no live page to
   * fetch through — and both are a report without call sites rather than a
   * report that is wrong.
   *
   * Handed to `locateSites` with the few nodes a region or a finding names. The
   * resolver is per collector rather than per subject: the cache is what makes
   * this bounded, and a suite's subjects share their modules.
   */
  readonly callSites?: CallSiteResolver;

  /**
   * Collect this subject again, in a world nothing else has touched.
   *
   * The saving this whole tool is built on is that the world is *not* rebuilt
   * between subjects (ADR-0009): one browser, one page, one Storybook, for the
   * length of a run. That saving is real and it is taken on every subject. What
   * it buys is the possibility that subject B renders differently because
   * subject A ran first — and a comparison cannot tell that apart from a
   * regression, because both arrive as "the pixels moved".
   *
   * One clean collection settles it. If the difference is gone with nothing else
   * in the world, the baseline was right and the session moved this subject.
   *
   * **Optional, and `undefined` is a real answer.** A collector holding a single
   * page open has no clean world to offer, and the run reports that rather than
   * reading it as "nothing leaked" — the standing constraint that a missing
   * capability is announced instead of defaulting to a silent negative.
   *
   * Called only for subjects the run already called `changed`, and only up to
   * `alone.limit`, so a green run never calls it at all.
   */
  collectAlone?(subject: PlannedSubject): Promise<Collected>;

  /**
   * Another standing world from the same recipe, for a second worker.
   *
   * Same build, same server, same origin — a world served from another port is
   * another page as far as a baseline is concerned, and every subject would read
   * changed with the port as its cause. A worker is a whole collector: the run hands it
   * subjects in its own serial lane and closes it before this one.
   *
   * Absent means one world, and a run configured with `workers` says so.
   */
  openWorker?(): Promise<Collector>;

  /**
   * Once, after the last subject and before the report. Whatever a collector
   * writes on the way out — the execution journal, for one — is on disk by the
   * time the report is assembled, so the report can carry it.
   *
   * `costs` is what the run timed for each subject it observed, first
   * collection to decision, by subject id — the figure the next run balances
   * its shards on, handed over so a collector that records execution records
   * that same time rather than timing the subject again. A subject the run did
   * not time is not in it.
   */
  close(costs?: ReadonlyMap<string, number>): Promise<void>;
}

/**
 * The same collector, closing its source once.
 *
 * The run closes the collector itself (see `close` above), and the command that
 * loaded it closes it again on the way out so a run that threw before reaching
 * that point still releases the browser. A source is told once; the second call
 * joins the first.
 */
export function closingOnce(collector: Collector): Collector {
  let closing: Promise<void> | undefined;
  return { ...collector, close: (costs) => (closing ??= collector.close(costs)) };
}

/** What the collector module's default export is called with. */
export interface CollectorContext {
  readonly config: Config;

  /**
   * The generic half of planning, already done — for **both** subject kinds.
   *
   * `storybook` supplies a story index parsed into subjects; `list` supplies the
   * configured ids. The binary produces one either way ({@link planFor}),
   * so a collector the CLI loaded can return `context.plan` from `plan()` and
   * write no planning of its own.
   *
   * Optional because the type also describes a caller composing `RunDeps` by
   * hand, who owes the collector nothing. This comment previously read "present
   * only for `subjects.kind: 'storybook'`", which is the reading that costs
   * something: an operator writing a `list` collector concludes the field is
   * undefined and hand-rolls what {@link planList} already returned.
   */
  readonly plan?: Plan;
}

export type SubjectSource = (context: CollectorContext) => Promise<Collector>;

/**
 * Glob over subject ids: `*` any run of characters, `?` exactly one.
 *
 * Deliberately not path-aware. A subject id is `story:components-button--primary`
 * — a namespaced identifier, not a filename — and treating `/` specially would
 * make `*` stop at a separator that carries no meaning here.
 */
export function matchesGlob(pattern: string, id: string): boolean {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (character) =>
    character === '*' ? '[\\s\\S]*' : character === '?' ? '[\\s\\S]' : `\\${character}`,
  );
  return new RegExp(`^${source}$`).test(id);
}

/**
 * Plan a run from a built Storybook's index.
 *
 * The generic half. Reading a declared index and applying exclusion policy needs
 * no browser, so it happens here where it can be tested — and every story the
 * index declared that this run will not observe becomes a `notObserved` entry
 * with the adapter's own reason attached.
 */
export async function planStorybook(
  indexPath: string,
  viewport: Viewport,
  excludeTags?: readonly string[],
): Promise<Plan> {
  const index = await readStoryIndex(indexPath);
  const plan = toSubjects(index, {
    viewport,
    ...(excludeTags !== undefined ? { excludeTags } : {}),
  });

  return {
    subjects: plan.subjects.map((story) => ({
      subject: story.subject,
      ...(story.viewport !== undefined ? { viewport: story.viewport } : {}),
      ...(story.story.tags.length > 0 ? { tags: story.story.tags } : {}),
      title: story.story.title,
      name: story.story.name,
      declaredIn: story.story.importPath.replace(/^\.\//, ''),
    })),
    notObserved: plan.excluded.map((entry) => ({
      subject: storySubjectId(entry.id),
      kind: 'excluded' as const,
      because: entry.reason,
    })),
    warnings: plan.warnings,
  };
}

/**
 * The store key a planned subject is looked up under and written to.
 *
 * One function because three callers build it — the run's working-set
 * declaration, selection's sidecar read, and the observation itself — and a key
 * carrying the file or the title at two of them would look a baseline up at a
 * path the third never wrote it to. That failure reads as `new`, and `new` records
 * whatever is on screen.
 */
export function keyFor(planned: PlannedSubject): BaselineKey {
  return {
    subject: planned.subject.id,
    ...(planned.declaredIn !== undefined ? { file: planned.declaredIn } : {}),
    ...(planned.title !== undefined ? { title: planned.title } : {}),
    ...(planned.name !== undefined ? { name: planned.name } : {}),
  };
}

/** Plan a run from an explicit list. Nothing is excluded; the operator wrote it. */
export function planList(ids: readonly string[]): Plan {
  return {
    subjects: ids.map((id) => ({ subject: { id, kind: 'fixture' as const } })),
    notObserved: [],
    warnings: [],
  };
}

/** The generic half of planning, when the config named a source that has one. */
export async function planFor(config: Config): Promise<Plan | undefined> {
  if (config.subjects.kind === 'storybook') {
    return planStorybook(config.subjects.index, config.viewport, config.subjects.excludeTags);
  }

  // `collector` returns nothing on purpose: the collector's own `plan()` is the
  // answer, and handing it an empty one to return would make an *absent* plan
  // and a *discovered empty* plan indistinguishable — the second is a suite that
  // watches nothing and has to be able to say so.
  if (config.subjects.kind === 'collector') return undefined;

  return planList(config.subjects.ids);
}

/** The collector module named by the configured subject source. */
export function collectorPath(subjects: SubjectsConfig): string {
  return subjects.collector;
}

/**
 * Import the operator's collector module.
 *
 * A local file, imported by path. Not a download and not a registry lookup — the
 * module is in the operator's repository, was reviewed like the rest of it, and
 * is named in the config rather than discovered.
 */
export async function loadCollector(
  path: string,
  context: CollectorContext,
): Promise<Collector> {
  let module: { readonly default?: unknown };
  try {
    module = (await import(pathToFileURL(path).href)) as { readonly default?: unknown };
  } catch (error) {
    throw new OperatorError(
      `cannot load the collector module ${path}: ${messageOf(error)}`,
      { cause: error },
    );
  }

  const source = module.default;
  if (typeof source !== 'function') {
    throw new OperatorError(
      `${path} must default-export a function (context) => Promise<Collector>; ` +
        'it exports ' +
        (source === undefined ? 'nothing' : typeof source),
    );
  }

  return closingOnce(await (source as SubjectSource)(context));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
