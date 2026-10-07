// compass: variance-authority.acquisition.suite-observation
import { performance } from 'node:perf_hooks';
import { componentInstances, lexiconValuesOf, withDeclaredIn, type SourceIndex } from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Config } from '../config.js';
import type { Shard } from '../shard-args.js';
import type { Collector } from './collector.js';
import { fieldsRead } from './compose.js';
import {
  evidencePlanOf,
  type EvidenceBuild,
  type EvidenceDiagnostic,
  type EvidencePart,
  type EvidenceRecipe,
  type SubjectOutcome,
} from './evidence-part.js';
import { closeLanes, openLanes, steal, workersOf } from './lanes.js';
import { assign, declinedBy } from './shard.js';
import type { PartSubject } from './suite-part.js';

/**
 * `variance collect`: read what a suite index is counted from, and nothing else.
 *
 * The same plan, the same cut into shards and the same lanes a run uses, and
 * the same reduction a run takes in its worker — a snapshot to its component
 * instances and its lexicon before the cap — with the snapshot dropped as soon
 * as that is taken. No store is asked, no image is rendered and nothing is
 * compared, so a collection needs no baselines and spends none of a run's
 * raster time. What it writes is one part; `variance collect merge` folds the
 * parts of every shard into the index.
 */

export interface CollectInput {
  readonly collector: Collector;
  /** `workers` and `concurrency`; nothing else of it is read here. */
  readonly config: Config;
  readonly shard?: Shard;
  /** `--subjects`: a glob over ids. What it leaves out is excluded, by name. */
  readonly scope?: string;
  /** The scan of `source.dirs`, when the config names any. */
  readonly source?: SourceIndex;
  readonly build: EvidenceBuild;
  readonly recipe: EvidenceRecipe;
  readonly elapsed?: () => number;
}

export async function collectEvidence(input: CollectInput): Promise<EvidencePart> {
  const elapsed = input.elapsed ?? (() => performance.now());
  const started = elapsed();
  const { collector } = input;

  try {
    const plan = await collector.plan();
    const assignment = assign(plan.subjects, input.shard, undefined);
    const outcomes: SubjectOutcome[] = [];
    const rows: PartSubject[] = [];
    const diagnostics: EvidenceDiagnostic[] = plan.warnings.map((message) => ({ severity: 'warn', code: 'plan', message }));
    const subjectDiagnostics = new Map<number, readonly EvidenceDiagnostic[]>();
    const costs: Record<string, number> = {};
    const located = new Map<string, readonly string[]>();

    // A shard that owns nothing opens nothing: its part is the proof it looked.
    if (assignment.queue.length > 0) {
      const { lanes, warnings } = await openLanes(collector, workersOf(input.config));
      diagnostics.push(...warnings.map((message): EvidenceDiagnostic => ({ severity: 'warn', code: 'workers', message })));
      await steal(lanes, assignment.queue, input.config, async (index, lane) => {
        const planned = plan.subjects[index]!;
        const id = planned.subject.id;
        const declined = declinedBy(id, undefined, input.scope);
        if (declined !== undefined) {
          outcomes.push({ position: index, subject: id, outcome: 'excluded', because: declined.because });
          return;
        }

        const begun = elapsed();
        const collected = await lane
          .collecting(async () => lane.collector.collect(planned))
          .catch((error: unknown) => ({ ok: false as const, because: error instanceof Error ? error.message : String(error) }));
        costs[id] = elapsed() - begun;
        if (!collected.ok) {
          outcomes.push({ position: index, subject: id, outcome: 'failed', because: collected.because });
          return;
        }

        outcomes.push({ position: index, subject: id, outcome: 'collected', snapshot: collected.snapshot !== undefined });
        if (collected.diagnostics !== undefined && collected.diagnostics.length > 0) {
          subjectDiagnostics.set(
            index,
            collected.diagnostics.map(({ severity, code, message }) => ({ subject: id, severity, code, message })),
          );
        }
        for (const [component, refs] of Object.entries(collected.source ?? {})) {
          locate(located, component, filesOf(refs));
        }
        // Reduced here, in the worker, so the snapshot ends with this subject.
        if (collected.snapshot !== undefined) {
          const instances = componentInstances(collected.snapshot);
          const lexicon = lexiconValuesOf({ subject: id, instances, snapshot: collected.snapshot });
          rows.push({ position: index, subject: id, instances, lexicon });
        }
      }).finally(async () => closeLanes(lanes));
    }

    outcomes.sort((left, right) => left.position - right.position);
    rows.sort((left, right) => left.position - right.position);
    for (const [, said] of [...subjectDiagnostics].sort(([left], [right]) => left - right)) diagnostics.push(...said);

    // The scan, with what the engines located laid over it, and laid into the
    // rows as a run lays its source index into its own.
    const scanned = input.source === undefined ? [] : Object.entries(input.source).map(([component, refs]) => [component, filesOf(refs)] as const);
    const declared = new Map([...scanned, ...[...located].sort(([l], [r]) => codeUnitOrder(l, r))]);
    const subjects = declared.size === 0 ? rows : rows.map((row) => ({ ...row, lexicon: withDeclaredIn(row.lexicon, row.instances, declared) }));
    const fields = fieldsRead({ snapshot: true, files: declared.size > 0 || subjects.some((row) => row.lexicon.fields.files !== undefined), regions: false });
    const { commit, ...build } = input.build;

    return {
      version: 1,
      ...(commit === undefined ? {} : { commit }),
      ...(input.shard === undefined ? {} : { shard: { index: input.shard.index, total: input.shard.total } }),
      planned: plan.subjects.length,
      subjects,
      // A part that read no snapshot read no field.
      ...(subjects.length === 0 ? {} : { fields }),
      ...(declared.size === 0 ? {} : { declaredIn: Object.fromEntries(declared) }),
      build,
      recipe: input.recipe,
      plan: evidencePlanOf(plan),
      assignment: 'checksum',
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      outcomes,
      diagnostics,
      acquisition: { ms: elapsed() - started, subjects: costs },
    };
  } finally {
    await collector.close();
  }
}

function filesOf(refs: readonly { readonly file: string }[]): readonly string[] {
  return [...new Set(refs.map((ref) => ref.file))];
}

/**
 * Keep the answer whose canonical form sorts first. A minimum is the same over
 * any order, so neither the subject that finished first nor the worker it ran
 * in decides which file a component is in.
 */
function locate(into: Map<string, readonly string[]>, component: string, files: readonly string[]): void {
  const held = into.get(component);
  if (held === undefined || codeUnitOrder(canonicalize(files as CanonicalValue), canonicalize(held as CanonicalValue)) < 0) {
    into.set(component, files);
  }
}
