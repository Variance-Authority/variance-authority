import type { JourneyParting, JourneyRegionRecord, JourneysReport } from '@variance-authority/report';
import type { CaseLanding } from '@variance-authority/sense/test-selection';
import { many } from './prose-counts.js';

/**
 * `variance journeys` — the one question that narrows a flake to a place.
 *
 * Every other reading this tool offers answers *which subject*. A recurrence
 * count names a subject that keeps moving, a churn list names a subject whose
 * baseline is rewritten weekly, a second reading names a subject that disagrees
 * with itself. None of them can say **where in the source** the two readings
 * parted, because none of them was inside the module while it ran.
 *
 * `journeyDivergences` was. Probes spliced into the arrival regions of the build
 * the run drove record which regions each subject crossed while it was painted,
 * so three stories that mount `CartCard` and one `onClick` body only one of them
 * ever entered is a fact the snapshot holds and no reading of the file could
 * produce — same file, same import graph, same props.
 *
 * ## What this command adds to the instrument
 *
 * The instrument takes a decoded snapshot and an optional observer filter. Both
 * of the things it leaves to a caller are decisions, and both are made here.
 *
 * **Which observers.** The snapshot accumulates across runs, so read whole it
 * answers about the record rather than about this run: a story deleted two
 * commits ago is still a party to every parting it was recorded in. So the
 * default pool is the subjects the configured report names — this run's
 * question, about this run's subjects. `--all` reads the record deliberately,
 * and a checkout with no report to read gets the record with a sentence saying
 * that is what it got, because a pool nobody chose must never print as one
 * somebody did.
 *
 * **What a truncated observation means.** A refused or cut-short observation is
 * kept in the snapshot, because the regions it crossed are real, and dropped
 * from the pool, because its *absences* are not evidence — counting one as
 * having missed a region manufactures a parting out of a recording that stopped
 * early. The instrument already drops them; this counts what it dropped and
 * says so, so that a pool of two that should have been three is visible rather
 * than inferred from a number nobody printed.
 *
 * ## It reports and never decides
 *
 * Exit is always `0`, for `changelog`'s reason: a parting is not a verdict about
 * the project. It is where to look, and a run that gated on it would fail every
 * suite whose stories legitimately take different paths — which is every suite
 * with more than one story per component.
 */

/**
 * How many modules are named before the rest are counted.
 *
 * Generous, and what it excludes is counted, which is the rule every capped
 * answer in this system follows: a cap that says nothing reads as coverage.
 */
const MAX_MODULES = 20;

/** How many regions of one module are named before the rest are counted. */
const MAX_REGIONS = 20;

/**
 * The snapshot, as this command needs it: the findings, and who the pool was.
 *
 * The report's own section, because `variance run` writes the same reading
 * beside its verdicts for every reader on a machine without the journal —
 * one vocabulary, carried rather than recomputed at the far end. The pool
 * travels beside the findings for the reason the section gives.
 */
export type RecordedJourneys = JourneysReport;

/**
 * How the pool was chosen.
 *
 * Three states rather than a list of observers, because *the record*, *the
 * record because you asked for it* and *the record because there was nothing
 * else to read* are three different claims about the same set of names.
 */
export type JourneyPool =
  | { readonly kind: 'run'; readonly named: number }
  | { readonly kind: 'all' }
  /** `report` is the report that was not there; absent under `--suite`, which reads none. */
  | { readonly kind: 'unasked'; readonly report?: string };

/**
 * One look at the cache, whether or not anything was there.
 *
 * The path is carried beside the snapshot rather than inside it, because the
 * case that most needs to name the path is the one with no snapshot to hold it:
 * an operator whose build carries no probes needs to be told where the file this
 * command wanted would have been.
 */
export interface JourneyReading {
  /** Where the snapshot was looked for. */
  readonly at: string;
  /** What was read there. Absent when this repository has no snapshot. */
  readonly recorded?: RecordedJourneys;
  /**
   * Subject → the lexical names of the regions its recording entered, over the
   * modules the instrument holds source for. The journal's own shape read the
   * other way: it keeps a region and the tests that entered it, and the lexicon
   * wants a subject and the regions it entered. Absent with `recorded`, and
   * carrying only subjects the journal holds, complete or not; a truncated
   * recording entered what it entered.
   */
  readonly entered?: ReadonlyMap<string, readonly string[]>;
}

/** What landing a fold of shard snapshots left on disk. */
export interface LandedJourneys {
  /** The file written. */
  readonly at: string;
  /** How many snapshots were folded into it. */
  readonly shards: number;
  readonly commit?: string;
  /** Whole and truncated observations the landed snapshot now holds. */
  readonly observations: number;
  readonly modules: number;
  /**
   * What the landing did to the case index beside the file written. Never a
   * busy index: that refuses the landing, and nothing is written to report on.
   */
  readonly cases?: CaseLanding;
  /** Shards whose record names the record its selection read `unknown`, so no read of theirs was checked. */
  readonly unchecked?: readonly string[];
}

export interface JourneysInput extends JourneyReading {
  readonly pool: JourneyPool;
  /** `--file <path>`: only the module at this path, spelled from the checkout as the record spells it. */
  readonly file?: string;
  /** `--limit <n>`: how many modules to name. */
  readonly limit?: number;
}

/** One module's findings, after the filter and the caps. */
export interface ShownModule {
  readonly file: string;
  readonly observers: readonly string[];
  readonly parted: readonly JourneyRegionRecord[];
  readonly unentered: readonly JourneyRegionRecord[];
  /** Regions of this module the cap left out, counted rather than dropped. */
  readonly elidedParted: number;
  readonly elidedUnentered: number;
}

export interface Journeys {
  readonly modules: readonly ShownModule[];
  /** Modules the cap left out. */
  readonly elided: number;
  /** Which observations the answer is about, always. */
  readonly pool: string;
  /** What the answer could not be about, and why. */
  readonly notes: readonly string[];
}

/**
 * Decide what to show and what to say about the pool it came from.
 *
 * Pure, and takes the snapshot already read and already narrowed: decoding a
 * binary index out of a user cache belongs to the caller, which is what makes
 * every rule above assertable with no cache, no build and no browser.
 */
export function journeysOf(input: JourneysInput): Journeys {
  const recorded = input.recorded;

  if (recorded === undefined) {
    // Not an empty answer. Nothing has ever recorded which regions a subject
    // entered here, and printing "no module was entered differently" would be
    // this tool answering a question it has no evidence about.
    return {
      modules: [],
      elided: 0,
      pool: `nothing, and there is no execution journal at ${input.at} to draw one from`,
      notes: [
        'a preview built with `testSelectionProbes()` from `@variance-authority/sense/journal` ' +
          'records one on every run; until one exists this question has no evidence rather ' +
          'than an empty answer',
      ],
    };
  }

  const matching = recorded.found.filter((divergence) => input.file === undefined || divergence.file === input.file);
  const limit = input.limit ?? MAX_MODULES;
  const modules = matching.slice(0, limit).map(shownModule);
  const elided = matching.length - modules.length;

  return {
    modules,
    elided,
    pool: poolSentence(input.pool, recorded),
    notes: notesFor(input, recorded, matching.length, elided),
  };
}

function shownModule(divergence: JourneyParting): ShownModule {
  return {
    file: divergence.file,
    observers: divergence.observers,
    parted: divergence.parted.slice(0, MAX_REGIONS),
    unentered: divergence.unentered.slice(0, MAX_REGIONS),
    elidedParted: Math.max(0, divergence.parted.length - MAX_REGIONS),
    elidedUnentered: Math.max(0, divergence.unentered.length - MAX_REGIONS),
  };
}

/**
 * The pool, in one sentence, printed whether or not anything was found.
 *
 * The sentence a reader needs before they read a single finding, and the one
 * they need most when there are none: an empty answer from a pool of one and an
 * empty answer from a pool of forty are opposite facts.
 */
function poolSentence(pool: JourneyPool, recorded: RecordedJourneys): string {
  const whole = `${many(recorded.whole.length, 'observation')} the journal recorded whole`;

  switch (pool.kind) {
    case 'run':
      return `${whole}, out of ${many(pool.named, 'subject')} the report names`;

    // Both widened pools are the accumulated record, not this run, and say so:
    // a subject deleted two commits ago is still a party to every parting it
    // was recorded in.
    case 'all':
      return `${whole}: the whole journal, as --all asked, so a deleted subject still counts`;

    case 'unasked':
      return pool.report === undefined
        ? `${whole}: the whole journal, because \`--suite\` reads no project config and has no report to narrow it by; a deleted subject still counts`
        : `${whole}: the whole journal, because there is no report at ${pool.report}, so a ` +
            'deleted subject still counts';
  }
}

function notesFor(
  input: JourneysInput,
  recorded: RecordedJourneys,
  found: number,
  elided: number,
): readonly string[] {
  const notes: string[] = [];

  notes.push(
    recorded.commit === undefined
      ? 'the journal does not say which commit it was recorded at, so how much of it is about ' +
          'code that still exists cannot be established from here'
      : `recorded at ${recorded.commit.slice(0, 12)}`,
  );

  if (recorded.truncated.length > 0) {
    // The rule `narrowByExecution` states, counted rather than assumed. A run cut
    // short entered fewer regions than the subject would have, so its absence
    // from one says nothing — and a pool that quietly shrank by three is a pool
    // whose emptiness reads as agreement.
    notes.push(
      `${many(recorded.truncated.length, 'in-scope observation')} truncated, dropped from the ` +
        'pool rather than counted as having missed anything ' +
        `(${listed(recorded.truncated)})`,
    );
  }

  if (recorded.unrecorded.length > 0) {
    notes.push(
      `the journal holds no row for ${many(recorded.unrecorded.length, 'named subject')} ` +
        `(${listed(recorded.unrecorded)}), so nothing here is about them — the last recording ` +
        'did not paint them, or happened before they existed',
    );
  }

  if (recorded.whole.length < 2) {
    // Said only when it is the answer. A parting is a disagreement between two
    // observers of one module, so a pool that cannot hold two has not found
    // nothing — it has not been able to look.
    notes.push(
      'a parting needs two observers of one module and this pool has fewer, so finding none ' +
        'is not an absence of partings',
    );
  }

  if (input.file !== undefined && found === 0 && recorded.found.length > 0) {
    notes.push(
      `${many(recorded.found.length, 'module')} parted, and ${input.file}, the path --file named, ` +
        'is not one of them',
    );
  }

  if (elided > 0) {
    notes.push(`${many(elided, 'more parted module')} not shown; raise --limit to see them`);
  }

  return notes;
}

/** Up to six names, and a count for the rest. */
function listed(names: readonly string[]): string {
  if (names.length <= 6) return names.join(', ');
  return `${names.slice(0, 6).join(', ')} and ${String(names.length - 6)} more`;
}

/**
 * The findings, as the operator reads them.
 *
 * One block per module: who entered it, then the regions they did not agree
 * about. `parted` and `unentered` are labelled rather than sectioned, because
 * they are different findings about the same module and a reader scanning for
 * the first should not have to scroll past a page of the second — a module with
 * one parting and forty never-entered branches is the ordinary shape.
 *
 * The pool is printed last and always, `changelog`'s rule: what bounded a
 * reading is the difference between "this is what parted" and "this is what
 * parted among the four subjects anything recorded", and only the second is ever
 * true.
 */
/**
 * The sentence a fold prints before the reading it made possible.
 *
 * Counts, not names: the shards were named on the command line and the reading
 * that follows names the modules. What the operator cannot otherwise see is
 * where the file went and where it now stands, which is what a laptop that just
 * installed a baseline fetched from CI needs to check against `git merge-base`.
 */
export function formatLanding(landed: LandedJourneys): string {
  return [
    `folded ${many(landed.shards, 'snapshot')} into ${landed.at}`,
    `  ${many(landed.observations, 'observation')} over ${many(landed.modules, 'module')}` +
      (landed.commit === undefined ? '' : `, recorded at ${landed.commit.slice(0, 12)}`),
    ...(landed.cases === undefined ? [] : [casesLine(landed.cases)]),
    ...(landed.unchecked === undefined || landed.unchecked.length === 0 ? [] : [`  ${uncheckedReads(landed.unchecked)}`]),
  ].join('\n');
}

/**
 * The shards a combine checked no read of: each record names the record its
 * selection read `unknown`, as a run that never sees its selection does (the
 * JVM agent). The combine passes them, and this says so.
 */
export function uncheckedReads(shards: readonly string[]): string {
  const one = shards.length === 1;
  const named = one ? shards[0] : `${shards.slice(0, -1).join(', ')} and ${shards.at(-1)}`;
  return one
    ? `the read of ${named} was not checked: its record names the record its selection read \`unknown\`, ` +
        'so nothing says it chose its tests from the record the other shards read'
    : `the reads of ${named} were not checked: their records name the record their selection read \`unknown\`, ` +
        'so nothing says they chose their tests from the record the other shards read';
}

function casesLine(cases: CaseLanding): string {
  if ('laid' in cases) {
    return cases.shards === 0
      ? `  case index at ${cases.laid} left as it was: no snapshot finished a test file`
      : `  cases of ${many(cases.shards, 'snapshot')} laid over ${cases.laid}`;
  }
  const why = cases.shards.length === 1
    ? `${cases.shards[0]} ran a test file to the end, and its record keeps no case index this build can read`
    : `${cases.shards.slice(0, -1).join(', ')} and ${cases.shards.at(-1)} ran test files to the end, and ` +
      'their records keep no case index this build can read';
  return cases.removed
    ? `  case index removed at ${cases.unanswered}: ${why}, so no index can say which of that file's cases run a line.`
    : `  no case index at ${cases.unanswered}: ${why}`;
}

export function formatJourneys(result: Journeys): string {
  const blocks = result.modules.map(block);

  if (blocks.length === 0) {
    blocks.push('no module was covered differently by two of the observers in this pool');
  }

  return [
    ...blocks,
    `pool: ${result.pool}`,
    ...result.notes.map((note) => `note: ${note}`),
  ].join('\n\n');
}

function block(module: ShownModule): string {
  return [
    `${module.file}  ${many(module.observers.length, 'observer')}`,
    ...module.parted.flatMap((region) => [
      `  parted     ${where(region)}`,
      `    entered  ${listed(region.entered)}`,
      `    missed   ${listed(region.missed)}`,
    ]),
    ...(module.elidedParted === 0
      ? []
      : [`  (${many(module.elidedParted, 'more parted region')} not shown)`]),
    ...module.unentered.map((region) => `  unentered  ${where(region)}`),
    ...(module.elidedUnentered === 0
      ? []
      : [`  (${many(module.elidedUnentered, 'more unentered region')} not shown)`]),
  ].join('\n');
}

/** A region, in the shape the instrument's own examples print it. */
function where(region: JourneyRegionRecord): string {
  const lines =
    region.startLine === region.endLine
      ? String(region.startLine)
      : `${String(region.startLine)}-${String(region.endLine)}`;

  return `${region.kind} ${region.name}  ${lines}`;
}
