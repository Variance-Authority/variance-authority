import {
  bandsBetween,
  causesBetween,
  formatSource,
  hashComponents,
  resolveSource,
  type SourceIndex,
} from '@variance-authority/core/attribute';
import type { Band } from '@variance-authority/core/compare';
import {
  documentDigest,
  type ComponentHash,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
import { absorbsEntirely, type Level } from '@variance-authority/core/judge';
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
  verdict: string,
  /** What this subject is asserted on, when a rule declared it. See `sensitivityFor`. */
  sensitivity: { readonly rule: string; readonly reason: string; readonly level: Level } | undefined,
  context: ObserveContext,
  collecting: <T>(job: () => Promise<T>) => Promise<T>,
): Promise<{ unstable?: NonNullable<CliObservationRecord['unstable']> }> {
  const { config, deps, budget } = context;
  const sweep = context.sweep === true;

  // Nothing to establish about a subject nobody has to review, and this is why a
  // green run pays for none of it — until `--flakes`, where the operator has
  // asked the opposite question: not *is this change real* but *which of these
  // subjects would flake tomorrow*. A subject that agrees with its baseline and
  // disagrees with itself is that answer, one run before it costs anybody a
  // build, and it is unreachable from a verdict.
  if (!sweep && verdict !== 'changed') return {};

  const limit = config.alone?.limit ?? DEFAULT_ALONE_LIMIT;

  // `limit: 0` turns the pass off, and it turns this one off too — one number
  // means "do not re-collect anything" or it means nothing. The *budget* is a
  // different matter: it caps how much of a red build's investigation is worth
  // paying for, and a sweep is not an investigation of a build. An operator who
  // asked for the sweep asked about the suite, and a run that answered for the
  // first twenty subjects while printing a whole-suite heading would be the
  // silently-partial answer this tool refuses everywhere else.
  if (limit === 0) return {};
  if (!sweep && budget.remaining <= 0) return {};

  // Through the collector's one lane, for the reason every other collection goes
  // through it: the world is a single standing page and two collections at once
  // render into the same one.
  const second = await collecting(async () => deps.collector.collect(planned));

  if (!second.ok) {
    // Not silence, and not a `failed` coverage entry either — the subject *was*
    // observed, once. A collector that produced this subject and then could not
    // produce it again has already answered the question this pass asks, and the
    // answer is the loudest form of yes.
    if (!sweep) budget.remaining -= 1;
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
  // A sweep charges nothing: it is not spending a red build's investigation
  // budget, and letting it do so would leave the clean-world pass with none.
  if (!sweep) budget.remaining -= 1;

  const moved = movedBetween(collected.snapshot, second.snapshot, collected.source);

  // The boundary. A subject that declared what it asserts on has already said
  // which movements are not its business, and demanding stability outside that
  // would make the declaration worthless — every route-level test written to
  // ignore what the page is painted with would go red over exactly that.
  //
  // The same predicate the verdict uses, deliberately: two answers to *is this
  // subject asserted on this band* that could disagree is a hole shaped like the
  // config. `strict` absorbs nothing and is how the exception is spelled.
  const absorbed =
    sensitivity !== undefined && moved !== undefined && absorbsEntirely(sensitivity.level, moved.bands)
      ? { rule: sensitivity.rule, level: sensitivity.level }
      : undefined;

  return {
    unstable: {
      components: moved?.components ?? [],
      bands: moved?.bands ?? [],
      ...(absorbed !== undefined ? { absorbed } : {}),
      because:
        'read twice in the same world, seconds apart, with nothing changed in between, ' +
        `and the two readings disagree${describeMovement(moved)}. ` +
        (absorbed !== undefined
          ? `Every band that moved is one this subject is not asserted on, by \`${absorbed.rule}\` ` +
            `(${sensitivity?.reason ?? absorbed.level}), so this is a fact about the page rather ` +
            'than a defect in it: nothing here gates, and nothing here is refused'
          : 'The subject does not read the same way twice, so ' +
            (verdict === 'changed'
              ? 'its difference against the baseline is neither confirmed nor cleared'
              : `its verdict of \`${verdict}\` was reached from one of two readings that do ` +
                'not agree, and the next run may reach the other one') +
            ' — no comparison of it means anything until that is fixed'),
    },
  };
}

type Unstable = NonNullable<CliObservationRecord['unstable']>;

interface Movement {
  readonly components: Unstable['components'];
  readonly bands: readonly Band[];
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
