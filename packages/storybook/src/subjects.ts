import type { SubjectRef, Viewport } from '@variance-authority/core/format';
import type { ExcludedEntry, StoryEntry, StoryIndex } from './index-file.js';

/**
 * From story entries to subjects, and the policy that sits between them.
 *
 * Two things happen here and neither belongs in the index reader. The reader
 * reports what a file says; this decides what a *run* does with it — which
 * stories are subjects, in what order, and at what viewport.
 *
 * **Where parameters come from, and why not from the index.** Storybook's
 * per-story parameters live in the story module. Evaluating that module is the
 * preview's job, so the index — which exists precisely to avoid evaluating
 * anything — carries only `type`, `title`, `name`, `importPath` and `tags`. This
 * package therefore takes parameters from the caller: either a project's own
 * configuration, or a map harvested from a running preview. Pretending they
 * could be read from `index.json` would mean inventing them, and an invented
 * viewport renders a subject at a size nobody asked for while reporting success.
 * What the index *does* carry is `tags`, so tag-based exclusion needs no help.
 *
 * **Ordering is load-bearing, not cosmetic.** JSON object key order is the order
 * a builder's file walk happened to produce, which varies with the filesystem
 * and the machine. Session pollution findings are directional — the culprit is
 * the subject that ran *earlier* (ADR-0009) — so a run whose order came from a
 * directory listing would attribute the same leak to different stories on
 * different machines. Subjects are therefore sorted here, by codepoint rather
 * than by locale: `localeCompare` orders differently under different `LANG`
 * settings, which is the same defect one layer down.
 */

/**
 * The subset of Storybook parameters this adapter acts on.
 *
 * Deliberately not "Storybook's parameters". Modelling `parameters.viewport`'s
 * full shape — named viewport tables, `defaultViewport` keys resolved against a
 * preview-level registry — would mean re-implementing an addon against a moving
 * target, and every guess would be a silently wrong render size. What is
 * accepted is the resolved answer: the size the story is to be observed at.
 */
export interface StoryParameters {
  /**
   * `true` keeps the story out of the run.
   *
   * The story is still reported, in {@link SubjectPlan.excluded}. A subject that
   * vanishes without a word is indistinguishable from one that passed, which is
   * the failure the whole system exists to avoid (ADR-0017).
   */
  readonly exclude?: boolean;

  readonly viewport?: StoryViewport;
}

/**
 * A per-story viewport override.
 *
 * Lengths may be numbers or `px` strings, because `px` strings are how
 * Storybook's own viewport entries are written (`styles: { width: '320px' }`)
 * and forcing a caller to reformat them invites an arithmetic mistake in the
 * one value that decides layout. Any other unit is refused rather than
 * converted: `em` and `vw` resolve against a font size and a window this
 * package has not seen.
 */
export interface StoryViewport {
  readonly width?: number | string;
  readonly height?: number | string;
  readonly deviceScaleFactor?: number;
  readonly colorScheme?: 'light' | 'dark';
}

export interface SubjectOptions {
  /**
   * The run's viewport, which per-story overrides are merged over.
   *
   * Optional, because a fully-specified override needs no base. A *partial*
   * override with no base cannot be completed, and that story is excluded with
   * the reason rather than rendered at some default — a story that asked for
   * 320px and got 1280px is a wrong observation, which is worse than a missing one.
   */
  readonly viewport?: Viewport;

  /** Parameters by story id. See the note above on why these are supplied. */
  readonly parameters?: Readonly<Record<string, StoryParameters>>;

  /**
   * Stories carrying any of these tags are excluded.
   *
   * Tags are the one piece of per-story policy the index really does carry, so
   * this is the only opt-out that works without a running preview.
   */
  readonly excludeTags?: readonly string[];
}

export interface StorySubject {
  readonly subject: SubjectRef;
  readonly story: StoryEntry;

  /**
   * Present only when a parameter overrode the run's viewport.
   *
   * Absent means "observe at the run's viewport", not "no viewport" — the
   * distinction matters because the viewport is part of the environment key, so
   * a harness serves exactly one of them. Honouring a subject that carries this
   * field means a second context, and a caller that ignores it produces
   * baselines keyed on a viewport the subject never rendered at.
   */
  readonly viewport?: Viewport;
}

export interface ExcludedStory {
  readonly id: string;
  readonly reason: string;
}

export interface SubjectPlan {
  readonly subjects: readonly StorySubject[];
  /** Every story the index declared that this run will not observe, with why. */
  readonly excluded: readonly ExcludedStory[];
  /** Carried through from the index, so warnings reach the report, not a log. */
  readonly warnings: readonly string[];
}

/**
 * The prefix subject ids carry, matching `SubjectRef`'s own documented example.
 *
 * Namespaced because one run may observe stories, routes, and fixtures, and a
 * baseline keyed on a bare `button--primary` collides the moment a route is
 * named the same thing.
 */
export function storySubjectId(storyId: string): string {
  return `story:${storyId}`;
}

export function toSubjects(index: StoryIndex, options: SubjectOptions = {}): SubjectPlan {
  const subjects: StorySubject[] = [];
  const excluded: ExcludedStory[] = index.excluded.map(carry);

  for (const story of [...index.stories].sort(compareStories)) {
    const parameters = options.parameters?.[story.id];
    const tag = story.tags.find((candidate) => options.excludeTags?.includes(candidate) === true);

    if (parameters?.exclude === true) {
      excluded.push({ id: story.id, reason: 'excluded by its own parameters (`exclude`)' });
      continue;
    }
    if (tag !== undefined) {
      excluded.push({ id: story.id, reason: `excluded by tag \`${tag}\`` });
      continue;
    }

    const subject: SubjectRef = {
      id: storySubjectId(story.id),
      kind: 'story',
      title: `${story.title}/${story.name}`,
    };

    if (parameters?.viewport === undefined) {
      subjects.push({ subject, story });
      continue;
    }

    const resolved = resolveViewport(parameters.viewport, options.viewport);
    if ('reason' in resolved) excluded.push({ id: story.id, reason: resolved.reason });
    else subjects.push({ subject, story, viewport: resolved.viewport });
  }

  return {
    subjects,
    excluded: [...excluded].sort((a, b) => byCodepoint(a.id, b.id)),
    warnings: index.warnings,
  };
}

function carry(entry: ExcludedEntry): ExcludedStory {
  return { id: entry.id, reason: entry.reason };
}

/**
 * Sidebar order, which is the order a person reading the report expects, with
 * the story id as a final tie-break so two stories sharing a title and a name
 * still order deterministically.
 */
function compareStories(a: StoryEntry, b: StoryEntry): number {
  return byCodepoint(a.title, b.title) || byCodepoint(a.name, b.name) || byCodepoint(a.id, b.id);
}

function byCodepoint(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

type Resolved = { readonly viewport: Viewport } | { readonly reason: string };

/**
 * Merge an override over the run's viewport, or say why it cannot be done.
 *
 * Failure is an exclusion rather than a throw, because a mistyped parameter on
 * one story must not decide the fate of the other 239 — and rather than a
 * fallback to the run viewport, because rendering at a size the story explicitly
 * rejected produces a baseline that is wrong rather than absent.
 */
function resolveViewport(override: StoryViewport, base: Viewport | undefined): Resolved {
  const width = pixels(override.width, 'width');
  if (typeof width === 'string') return { reason: width };
  const height = pixels(override.height, 'height');
  if (typeof height === 'string') return { reason: height };

  if (override.deviceScaleFactor !== undefined && !(override.deviceScaleFactor > 0)) {
    return {
      reason: `viewport parameter has a \`deviceScaleFactor\` of ${String(override.deviceScaleFactor)}, which cannot be rendered`,
    };
  }

  const mergedWidth = width ?? base?.width;
  const mergedHeight = height ?? base?.height;
  const scale = override.deviceScaleFactor ?? base?.deviceScaleFactor;
  const scheme = override.colorScheme ?? base?.colorScheme;

  if (mergedWidth === undefined || mergedHeight === undefined || scale === undefined || scheme === undefined) {
    const missing = [
      mergedWidth === undefined ? 'width' : null,
      mergedHeight === undefined ? 'height' : null,
      scale === undefined ? 'deviceScaleFactor' : null,
      scheme === undefined ? 'colorScheme' : null,
    ].filter((field): field is string => field !== null);

    return {
      reason:
        `viewport parameter is partial and no run viewport was configured to complete it ` +
        `(missing ${missing.join(', ')}); observing it at a guessed size would be a wrong ` +
        `observation rather than a missing one`,
    };
  }

  return {
    viewport: { width: mergedWidth, height: mergedHeight, deviceScaleFactor: scale, colorScheme: scheme },
  };
}

/**
 * A CSS pixel length, `null` when absent, or a refusal sentence.
 *
 * The three-way return keeps "not stated" and "stated, unusable" apart. Folding
 * them together would let `width: '20em'` fall back to the run viewport, which
 * is the silent wrong render this function exists to prevent.
 */
function pixels(value: number | string | undefined, field: string): number | null | string {
  if (value === undefined) return null;
  if (typeof value === 'number') {
    return value > 0 ? value : `viewport parameter \`${field}\` is ${value}, which cannot be rendered`;
  }

  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  if (match === null || match[1] === undefined) {
    return (
      `viewport parameter \`${field}\` is ${JSON.stringify(value)}; only pixel lengths can be ` +
      `resolved here, since a relative unit resolves against a font size or a window this ` +
      `package has not seen`
    );
  }

  const parsed = Number(match[1]);
  return parsed > 0 ? parsed : `viewport parameter \`${field}\` is ${JSON.stringify(value)}, which cannot be rendered`;
}
