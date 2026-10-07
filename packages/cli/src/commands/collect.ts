// compass: variance-authority.acquisition.suite-observation
import { performance } from 'node:perf_hooks';
import {
  componentInstances,
  lexiconValuesOf,
  type LexiconField,
  type LexiconValues,
  type SourceIndex,
} from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import type { Config } from '../config.js';
import type { Shard } from '../shard-args.js';
import type { Collector } from './collector.js';
import {
  EVIDENCE_FORMAT,
  EVIDENCE_VERSION,
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

    const declaredIn = input.source === undefined ? undefined : filesByComponent(input.source);
    const locatedFiles = located.size === 0 ? undefined : Object.fromEntries([...located].sort(([l], [r]) => codeUnit(l, r)));
    const fields = evidenceFieldsOf(rows.map((row) => row.lexicon), declaredIn !== undefined || locatedFiles !== undefined);

    return {
      format: EVIDENCE_FORMAT,
      version: EVIDENCE_VERSION,
      build: input.build,
      recipe: input.recipe,
      plan: evidencePlanOf(plan),
      ...(input.shard === undefined ? {} : { shard: { index: input.shard.index, total: input.shard.total } }),
      assignment: { by: 'checksum' },
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      outcomes,
      subjects: rows,
      ...(fields === undefined ? {} : { fields }),
      ...(declaredIn === undefined ? {} : { declaredIn }),
      ...(locatedFiles === undefined ? {} : { located: locatedFiles }),
      diagnostics,
      acquisition: { ms: elapsed() - started, subjects: costs },
    };
  } finally {
    await collector.close();
  }
}

/**
 * Which fields a set of rows was read under — the rule a run applies
 * (`lexiconReadingOf`), over rows already taken. Every row here carried a
 * snapshot, so a row at all is the evidence for `names`, `text` and `roles`.
 * `undefined` for no rows, which read nothing.
 */
export function evidenceFieldsOf(rows: readonly LexiconValues[], sourced: boolean): readonly LexiconField[] | undefined {
  if (rows.length === 0) return undefined;
  const fields: LexiconField[] = ['example', 'components', 'createdBy', 'tokens', 'names', 'text', 'roles'];
  if (sourced || rows.some((row) => row.fields.files !== undefined)) fields.push('files');
  return fields;
}

/** Each component's declaring files, once each, in the order the index named them. */
export function filesByComponent(source: SourceIndex): Record<string, readonly string[]> {
  return Object.fromEntries(Object.entries(source).map(([component, refs]) => [component, filesOf(refs)]));
}

function filesOf(refs: readonly { readonly file: string }[]): readonly string[] {
  return [...new Set(refs.map((ref) => ref.file))];
}

/**
 * Keep the answer whose canonical form sorts first. A minimum is the same over
 * any order and any grouping, so the subject that finished first, the worker it
 * ran in and the shard that held it never decide which file a component is in.
 */
export function locate(into: Map<string, readonly string[]>, component: string, files: readonly string[]): void {
  const held = into.get(component);
  if (held === undefined || codeUnit(canonicalize(files as CanonicalValue), canonicalize(held as CanonicalValue)) < 0) {
    into.set(component, files);
  }
}

function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
