import {
  attributeMovement,
  composeSubjects,
  lexiconOf,
  structureOf,
  type Divergence,
  type Echo,
  type Evidence,
  type LexiconField,
  type Moved,
  type Movement,
  overlaySourceIndex,
  type SourceIndex,
  type SubjectComposition,
} from '@variance-authority/core/attribute';
import { BANDS, type Band } from '@variance-authority/core/compare';
import type {
  CompositionReport,
  DivergenceRecord,
  EchoRecord,
  LexiconReport,
  MovementRecord,
} from '@variance-authority/report';
import type { CliObservationRecord, CliRunReport } from './run-report.js';

/**
 * The run's second axis: its subjects compared to each other.
 *
 * Everything else `variance run` does is *one subject against its baseline*. This
 * phase asks the question that needs the whole suite at once — **which of these
 * examples are watching the same component, and what does that say about the ones
 * that moved** — and it asks it from digests the collection already produced.
 * There is no second render in here, no image, and no store.
 *
 * ## Why it is a fold and not an accumulation
 *
 * The report has to be a function of the plan. The worker pool fills a
 * plan-indexed array and this runs afterwards over it in order, so a slower
 * machine that finished subject 41 before subject 3 produces the same bytes. The
 * same argument the slot fold in `run.ts` makes, for the same reason, and it is
 * the reason this is a function taking values rather than something the loop
 * updates as it goes.
 *
 * ## What it will not conclude
 *
 * A movement nothing explains is **not** a flake here. The position has not
 * moved: a subject is unstable when it fails to read the same way twice, and one
 * reading can never establish that ([`flakiness.md`](../../../../docs/flakiness.md)).
 * What this produces is the *shortlist* — the subjects a sweep should spend its
 * second readings on — and `standing: 'flake'` appears only where the run already
 * has both halves: an unexplained movement in a subject that also disagreed with
 * itself.
 */

/**
 * How many echoes reach the artifact.
 *
 * A design system with forty components across three hundred subjects produces
 * thousands of shared renderings, and the report is a file people open. The cap
 * is generous and what it excludes is counted in `truncated`, which is the rule
 * every capped answer in this system follows: a cap that says nothing reads as
 * coverage.
 */
const MAX_ECHOES = 100;

export interface ComposeInput {
  /** One slot per planned subject, in plan order; `null` where nothing was read. */
  readonly subjects: readonly (SubjectComposition | null)[];
  readonly observations: readonly CliObservationRecord[];

  /**
   * Files the diff named, from `--since` or `--against`. Absent when neither asked.
   *
   * Absent rather than `[]`, all the way down to `attributeMovement`, because a
   * run that did not ask has not established that nobody edited anything — and
   * reading its silence as "no edits" would attribute the whole suite to nothing
   * and call the result a flake list.
   */
  readonly changed?: readonly string[];

  /** The component index the same `--since` scan built. */
  readonly source?: SourceIndex;

  /**
   * Where the components the run rendered are declared, asked of the engine by
   * the collector and carried on each collection. Laid over `source`: a name the
   * engine located replaces the scan's candidates for it, which is how an
   * ambiguous name becomes one file, and a name it never met keeps the scan's.
   */
  readonly declared?: SourceIndex;

  /** Custom properties that took a new value in this run, from the record. */
  readonly tokens?: readonly string[];

  /**
   * Subject → the regions its journey entered, off the journal. Absent when no
   * journal was read, which the lexicon records as a field it did not read
   * rather than as every subject having entered nothing.
   */
  readonly regions?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Compose one run's subjects, attribute what moved, and shrink it to the report.
 *
 * `undefined` when no subject supplied a snapshot — a raster-only tier has no
 * boundaries to join, and an empty graph in the artifact would read as "this
 * suite shares nothing", which is a different and false claim.
 */
export function compositionOf(input: ComposeInput): CompositionReport | undefined {
  const present = input.subjects.filter((subject) => subject !== null);
  if (present.length === 0) return undefined;

  const composition = composeSubjects(present);
  const attribution = attributeMovement(
    movedIn(input.observations),
    composition,
    evidenceFrom(input),
  );

  const echoes = composition.echoes.map(echoRecord);

  return {
    subjects: composition.subjects,
    components: composition.components.map((entry) => ({
      component: entry.component,
      subjects: entry.subjects,
      instances: entry.instances,
      examples: entry.examples,
      within: entry.within,
      createdBy: entry.createdBy,
      renders: entry.renders,
      tokens: entry.tokens,
      variants: entry.classes.length,
      renderings: entry.classes.reduce((total, group) => total + group.renderings.length, 0),
    })),
    echoes: echoes.slice(0, MAX_ECHOES),
    divergences: composition.divergences.map(divergenceRecord),
    movements: attribution.movements.map((movement) =>
      movementRecord(movement, attribution.flakes, attribution.suspects),
    ),
    structure: present.map((subject) => ({
      subject: subject.subject,
      rows: structureOf(subject),
    })),
    ...(echoes.length > MAX_ECHOES ? { truncated: { echoes: echoes.length - MAX_ECHOES } } : {}),
  };
}

/**
 * Every name each subject carries, written for the readers that hold no snapshot.
 *
 * The same `undefined` as `compositionOf`, for the same reason: a raster-only
 * tier read no boundaries, and an index with every field empty would answer
 * "nothing matched" to a reader whose true answer is "nothing was read".
 *
 * `fields` is the run's admission of what it looked at. `regions` is read only
 * when a journal was; `files` only when a source index or a snapshot with
 * provenance was at hand; the snapshot's own fields only when a subject carried
 * one. A locator answering over this report prints the absent fields beside its
 * hits, so a miss on a field nobody read is never reported as a miss.
 */
export function lexiconReportOf(input: ComposeInput): LexiconReport | undefined {
  const present = input.subjects.filter((subject) => subject !== null);
  if (present.length === 0) return undefined;

  const composition = composeSubjects(present);
  const examples = new Map<string, string[]>();
  for (const entry of composition.components) {
    for (const subject of entry.examples) {
      let held = examples.get(subject);
      if (held === undefined) examples.set(subject, (held = []));
      held.push(entry.component);
    }
  }

  const declaredIn = new Map<string, readonly string[]>();
  for (const [component, refs] of Object.entries(input.source ?? {})) {
    declaredIn.set(component, [...new Set(refs.map((ref) => ref.file))]);
  }

  const withSnapshot = present.some((subject) => subject.snapshot !== undefined);
  const fields: LexiconField[] = ['example', 'components', 'createdBy', 'tokens'];
  if (withSnapshot) fields.push('names', 'text', 'roles');
  if (withSnapshot || input.source !== undefined) fields.push('files');
  if (input.regions !== undefined) fields.push('regions');

  return {
    version: 1,
    fields: FIELD_ORDER.filter((field) => fields.includes(field)),
    subjects: lexiconOf(present, {
      examples,
      ...(input.source === undefined ? {} : { declaredIn }),
      ...(input.regions === undefined ? {} : { regions: input.regions }),
    }),
  };
}

/** The order fields are named in, wherever a report or a tool lists them. */
const FIELD_ORDER: readonly LexiconField[] = [
  'example',
  'names',
  'text',
  'components',
  'createdBy',
  'regions',
  'files',
  'roles',
  'tokens',
];

/**
 * Every component this run found to have moved, and in which subject.
 *
 * Two sources, and the second is the one the sweep exists to produce:
 *
 * - A subject that differs from its **baseline** contributes the components its
 *   regions named as *causes*. Collateral is excluded for the reason
 *   `causesBetween` excludes it — a component whose box was pushed by something
 *   else sends a reviewer to a file nobody edited.
 * - A subject that differs from **itself** contributes the components the second
 *   reading named. Those are the interesting ones: a green subject that disagrees
 *   with itself is invisible to every comparison in the report, and it is exactly
 *   what `--flakes` spends a whole extra collection to find.
 *
 * Bands come from the second reading when there was one and are otherwise empty,
 * which `Moved` documents as *not known* rather than *no band*: a region names a
 * component and says nothing about which frequency moved.
 */
function movedIn(observations: readonly CliObservationRecord[]): readonly Moved[] {
  const moved = new Map<string, Moved>();

  for (const record of observations) {
    for (const region of record.regions) {
      if (!region.cause || region.component === undefined) continue;
      const key = `${record.subject} ${region.component}`;
      if (!moved.has(key)) {
        moved.set(key, {
          subject: record.subject,
          component: region.component,
          bands: [],
        });
      }
    }

    // Written after the regions and allowed to replace them, because this is the
    // same movement described better: the second reading knows which bands moved
    // and a region does not.
    const bands = bandsOf(record.unstable?.bands ?? []);
    for (const component of record.unstable?.components ?? []) {
      moved.set(`${record.subject} ${component.name}`, {
        subject: record.subject,
        component: component.name,
        bands,
      });
    }
  }

  return [...moved.values()];
}

/**
 * What the run can put beside a movement, and what it must stay silent about.
 *
 * Every field here is optional in `Evidence` and every absence is load-bearing.
 * A run with no `--since` cannot reach the `edited` rung, so its unexplained
 * movements carry a sentence saying so instead of a confident accusation; a run
 * with no history store cannot say a token moved, so the `token` rung is
 * unreachable rather than answered `no`.
 */
function evidenceFrom(input: ComposeInput): Evidence {
  const declaredIn = new Map<string, readonly string[]>();
  for (const [component, refs] of Object.entries(input.source ?? {})) {
    declaredIn.set(component, [...new Set(refs.map((ref) => ref.file))]);
  }

  const unstable = new Set(
    input.observations
      .filter((record) => record.unstable !== undefined)
      .map((record) => record.subject),
  );

  // Only subjects whose hashes were actually compared. A record with `moved`
  // omitted had no baseline digests to read, and entering it here as an empty
  // set would offer every component in it as a control that held still.
  const hashesMoved = new Map<string, ReadonlySet<string>>(
    input.observations
      .filter((record) => record.moved !== undefined)
      .map((record) => [
        record.subject,
        new Set((record.moved ?? []).map((entry) => entry.component)),
      ]),
  );

  return {
    ...(input.changed === undefined ? {} : { changed: input.changed }),
    ...(input.source === undefined ? {} : { declaredIn }),
    ...(input.tokens === undefined ? {} : { tokens: input.tokens }),
    ...(hashesMoved.size === 0 ? {} : { hashesMoved }),
    unstable,
  };
}

function echoRecord(echo: Echo): EchoRecord {
  return {
    component: echo.component,
    rendering: echo.rendering,
    subjects: distinct(echo.sites.map((site) => site.subject)),
    sites: echo.sites.length,
    ...(echo.example === undefined ? {} : { example: echo.example }),
  };
}

/**
 * Kept grouped, because flattening it is what made the finding unreadable.
 *
 * `core` returns the renderings widest first and each one knows its own sites;
 * folding them into one subject list and a count — which this did — discards the
 * only fact a reader needs, namely which subjects agreed with each other. The
 * grouping costs nothing to carry and cannot be recovered downstream.
 */
function divergenceRecord(divergence: Divergence): DivergenceRecord {
  return {
    component: divergence.component,
    bands: divergence.bands,
    renderings: divergence.renderings.map((rendering) =>
      distinct(rendering.sites.map((site) => site.subject)),
    ),
    ...(divergence.partings === undefined || divergence.partings.length === 0
      ? {}
      : { partings: divergence.partings }),
  };
}

function movementRecord(
  movement: Movement,
  flakes: readonly Movement[],
  suspects: readonly Movement[],
): MovementRecord {
  // Identity, not a re-derivation. `attributeMovement` decided the split and this
  // is only asking which list the object it already returned ended up in — a
  // second copy of the rule here would be one edit away from a report whose
  // shortlist disagrees with its own movements.
  const standing = flakes.includes(movement)
    ? 'flake'
    : suspects.includes(movement)
      ? 'suspect'
      : undefined;

  return {
    subject: movement.subject,
    component: movement.component,
    bands: movement.bands,
    cause: movement.cause,
    because: movement.because,
    ...(movement.file === undefined ? {} : { file: movement.file }),
    ...(movement.tokens === undefined ? {} : { tokens: movement.tokens }),
    ...(movement.upstream === undefined ? {} : { upstream: movement.upstream }),
    ...(movement.through === undefined ? {} : { through: movement.through }),
    alsoIn: movement.alsoIn,
    held: distinct(movement.held.map((site) => site.subject)),
    compared: movement.compared,
    ...(standing === undefined ? {} : { standing }),
  };
}

/** First occurrence wins, so the order is whatever the caller's order was. */
function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * The report's band strings, narrowed to the union `core` understands.
 *
 * The same check `history-rows.ts` makes and for the same reason: the report
 * types its bands as strings, so a value nothing recognises is dropped from the
 * *naming* rather than trusted into a type that promises it is one of five. It is
 * never dropped from the movement — the component did move, and withholding it
 * because a label was unfamiliar would answer "nothing moved" about something
 * that did.
 */
function bandsOf(bands: readonly string[]): readonly Band[] {
  return BANDS.filter((band) => bands.includes(band));
}

/**
 * Both folds over one input, as the sections the report carries.
 *
 * One call rather than two because the census and the lexicon describe the
 * same subjects the two ways round, and a run that handed them different
 * inputs would write a lexicon naming subjects its census never counted.
 */
export function composeReports(given: ComposeInput): Pick<CliRunReport, 'composition' | 'lexicon'> {
  const input = withDeclared(given);
  const composition = compositionOf(input);
  const lexicon = lexiconReportOf(input);
  return {
    ...(composition === undefined ? {} : { composition }),
    ...(lexicon === undefined ? {} : { lexicon }),
  };
}

/** The scan under what the engine said, as one `source`; the input unchanged when the engine said nothing. */
function withDeclared({ declared, ...input }: ComposeInput): ComposeInput {
  if (declared === undefined) return input;
  return { ...input, source: overlaySourceIndex(input.source ?? {}, declared) };
}
