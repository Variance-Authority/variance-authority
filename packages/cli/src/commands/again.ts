import {
  bandsBetween,
  causesBetween,
  documentDigest,
  formatSource,
  hashComponents,
  resolveSource,
  type ComponentHash,
  type SemanticSnapshot,
  type SourceIndex,
} from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';
import { DEFAULT_ALONE_LIMIT } from '../config.js';
import type { Collected, PlannedSubject } from './collector.js';
import type { ObserveContext } from './run-context.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * Read the subject a second time, change nothing, and see whether it agrees with
 * itself.
 *
 * The other second pass, and the counterweight to `alone.ts` rather than a
 * variant of it. **Two experiments, one variable each:**
 *
 * | | world | time | answers |
 * |---|---|---|---|
 * | `alone` | rebuilt | same | did some *other* subject move this one? |
 * | `again` | held | advanced | does this subject move on its own? |
 *
 * Neither substitutes for the other and neither is a retry. A leak that fires on
 * every run never moves between two readings of the same world, so `again` is
 * blind to exactly what `alone` is for; and a subject whose clock ticks between
 * readings differs alone as loudly as it differs in company, so `alone` reports
 * "the change is still there, so it is the component" — a sentence about a
 * component nobody edited.
 *
 * ## Why this one runs first
 *
 * Because `alone`'s answer is uninterpretable on a subject that does not read the
 * same way twice. Its whole inference is *the clean reading differs from the
 * shared one, therefore the world moved it* — and that is only evidence if two
 * readings of one world would have agreed. Run in the other order, an unstable
 * subject produces a confident sentence about the suite, aimed at a bisection
 * that will never converge.
 *
 * So instability is established first, and when it is found `alone` is skipped:
 * there is nothing left for it to establish, and the run keeps the render.
 *
 * ## What it costs, and why it is not a paint
 *
 * One collection, and **never a rasterization.** A `RenderDocument` is a complete
 * statement of what is to be painted, so two documents with the same digest
 * cannot paint differently — the same argument `settle` makes to skip a render
 * against a baseline, made here between two readings taken seconds apart. The
 * check is therefore a document digest comparison, at the cost of the cheap tier
 * (~3.4ms on a semantic collection, ADR-0010) against the ~65ms paint this
 * subject has already paid.
 *
 * It runs only on subjects the run already called `changed`, and only inside
 * `alone.limit`, so a green run pays nothing at all — the same economy the clean
 * world pass has.
 *
 * ## What it can and cannot see
 *
 * It names the component and the band, because the two readings are two
 * documents and a document carries its component hashes. `Clock (content)` is a
 * different day's work from `Header (geometry)`, and an operator handed only
 * "this subject is flaky" has to find that out by reading the page.
 *
 * **Two readings is a lower bound, not a certificate.** A subject that reads
 * differently one time in fifty passes this check forty-nine times out of fifty,
 * and nothing in a report may present that silence as stability — which is why an
 * absent `unstable` field means *this run's two readings agreed*, and is stated
 * in `format.ts` as meaning exactly that. Raster-level nondeterminism is invisible
 * here for the same reason it is cheap: it does not move a document digest.
 */
export async function again(
  planned: PlannedSubject,
  collected: Extract<Collected, { ok: true }>,
  observation: Observation,
  context: ObserveContext,
  collecting: <T>(job: () => Promise<T>) => Promise<T>,
): Promise<{ unstable?: NonNullable<CliObservationRecord['unstable']> }> {
  const { config, deps, budget } = context;

  // Nothing to establish about a subject nobody has to review, and this is why a
  // green run pays for none of it.
  if (observation.verdict !== 'changed') return {};

  const limit = config.alone?.limit ?? DEFAULT_ALONE_LIMIT;
  if (limit === 0 || budget.remaining <= 0) return {};

  // Through the collector's one lane, for the reason every other collection goes
  // through it: the world is a single standing page and two collections at once
  // render into the same one.
  const second = await collecting(async () => deps.collector.collect(planned));

  if (!second.ok) {
    // Not silence, and not a `failed` coverage entry either — the subject *was*
    // observed, once. A collector that produced this subject and then could not
    // produce it again has already answered the question this pass asks, and the
    // answer is the loudest form of yes.
    budget.remaining -= 1;
    return {
      unstable: {
        components: [],
        bands: [],
        because:
          'collected once and then failed to collect a second time, seconds later, with ' +
          `nothing changed in between: ${second.because}. Whatever the comparison said ` +
          'about this subject was said about a reading that cannot be taken twice',
      },
    };
  }

  if (documentDigest(collected.document) === documentDigest(second.document)) return {};

  // Charged here rather than in `alone`, because `alone` is about to be skipped
  // and this subject must still count against the run's cap. Every investigated
  // subject spends exactly one, whichever of the two passes reached a finding.
  budget.remaining -= 1;

  const moved = movedBetween(collected.snapshot, second.snapshot, collected.source);

  return {
    unstable: {
      components: moved?.components ?? [],
      bands: moved?.bands ?? [],
      because:
        'read twice in the same world, seconds apart, with nothing changed in between, ' +
        `and the two readings disagree${describeMovement(moved)}. The subject does not ` +
        'read the same way twice, so its difference against the baseline is neither ' +
        'confirmed nor cleared — and no comparison of it means anything until that is fixed',
    },
  };
}

type Unstable = NonNullable<CliObservationRecord['unstable']>;

interface Movement {
  readonly components: Unstable['components'];
  readonly bands: readonly string[];
}

/**
 * Which components disagreed, and in which bands.
 *
 * `undefined` when either reading came without a snapshot, and that is a real
 * state rather than an empty answer: a collector that supplies documents and no
 * snapshots has proved the instability and has given nobody the means to name it.
 * Returning empty lists there would read as *the disagreement belongs to no
 * component*, which is a claim about the page rather than about the collector.
 *
 * The same two functions the comparison path uses, deliberately. A second
 * implementation of "which component moved" would drift from the one that decides
 * verdicts, and the whole point of naming a band here is that it is the band a
 * sensitivity rule would speak about.
 */
function movedBetween(
  first: SemanticSnapshot | undefined,
  second: SemanticSnapshot | undefined,
  source: SourceIndex | undefined,
): Movement | undefined {
  if (first === undefined || second === undefined) return undefined;

  const before: readonly ComponentHash[] = hashComponents(first);
  const after: readonly ComponentHash[] = hashComponents(second);

  // The file, wherever the name resolves to one. A component name sends a reader
  // to a search; `src/ds/Clock.tsx:22` sends them to the line, and the index that
  // answers that is already in the collector's hands.
  const components = causesBetween(before, after).map((name) => {
    const resolved = source === undefined ? null : resolveSource(name, source);
    return resolved === null ? { name } : { name, file: formatSource(resolved) };
  });

  return { components, bands: bandsBetween(before, after) };
}

/** The naming half of the sentence, absent when nothing could name it. */
function describeMovement(moved: Movement | undefined): string {
  if (moved === undefined) {
    return ' (no snapshot was collected, so the disagreement could not be resolved to a component)';
  }
  if (moved.components.length === 0) {
    return moved.bands.length === 0 ? '' : ` in ${moved.bands.join(', ')}`;
  }

  const bands = moved.bands.length === 0 ? '' : ` (${moved.bands.join(', ')})`;
  const named = moved.components
    .map((component) =>
      component.file === undefined ? component.name : `${component.name} ${component.file}`,
    )
    .join(', ');
  return `: ${named} read differently${bands}`;
}
