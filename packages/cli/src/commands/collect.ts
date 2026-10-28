// compass: variance-authority.acquisition.collector-contract
import { performance } from 'node:perf_hooks';
import type { SourceIndex } from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Config } from '../config.js';
import type { Shard } from '../shard-args.js';
import { acquire } from './acquire.js';
import type { Collector } from './collector.js';
import { lexiconReadingOf, withDeclared } from './compose.js';
import {
  evidenceEnvironmentOf,
  evidencePlanOf,
  type EvidenceBuild,
  type EvidenceDiagnostic,
  type EvidenceEnvironment,
  type EvidencePart,
  type EvidenceRecipe,
  type SubjectOutcome,
} from './evidence-part.js';
import { assign } from './shard.js';
import { suitePartOf } from './suite-part.js';

/**
 * `variance collect`: read what a suite index is counted from, and nothing else.
 *
 * A run's own acquisition and its own suite part — the same plan, cut, lanes
 * and reading — with no store asked, no image rendered and nothing compared,
 * so a collection needs no baselines and spends none of a run's raster time.
 * What it adds is what a merge checks parts against: the build, the recipe, the
 * plan, and an outcome for every subject the shard owns. `variance collect
 * merge` folds the parts of every shard into the index.
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
    // One list per planned subject: a visit may realize several.
    const outcomes: SubjectOutcome[][] = plan.subjects.map(() => []);
    const said: EvidenceDiagnostic[][] = plan.subjects.map(() => []);
    const costs: Record<string, number> = {};
    const environments = new Map<string, EvidenceEnvironment>();
    // The planned subject a realized one came from, when they differ.
    const ofPlanned = (position: number, subject: string): { of?: string } => {
      const planned = plan.subjects[position]!.subject.id;
      return planned === subject ? {} : { of: planned };
    };

    const { compositions, declared, warnings } = await acquire({
      plan,
      queue: assign(plan.subjects, input.shard, undefined).queue,
      collector,
      config: input.config,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      elapsed,
      passed: (position, { subject, kind, because }) => {
        outcomes[position]!.push({ position, subject, ...ofPlanned(position, subject), outcome: kind, because });
      },
      read: async (position, planned, collected, _lane, begun) => {
        const subject = planned.subject.id;
        costs[subject] = elapsed() - begun!;
        outcomes[position]!.push({ position, subject, ...ofPlanned(position, subject), outcome: 'collected', snapshot: collected.snapshot !== undefined });
        if (collected.snapshot !== undefined) {
          const environment = evidenceEnvironmentOf(collected.snapshot.environment.inputs);
          environments.set(canonicalize(environment as unknown as CanonicalValue), environment);
        }
        if (collected.diagnostics !== undefined && collected.diagnostics.length > 0) {
          said[position]!.push(...collected.diagnostics.map(({ severity, code, message }) => ({ subject, severity, code, message })));
        }
      },
    });

    const reading = lexiconReadingOf(
      withDeclared({
        subjects: compositions.flat(),
        observations: [],
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(declared === undefined ? {} : { declared }),
      }),
    );
    const { commit, ...build } = input.build;

    return {
      ...suitePartOf(compositions, reading, commit, input.shard),
      build,
      recipe: input.recipe,
      environments: [...environments].sort(([left], [right]) => codeUnitOrder(left, right)).map(([, environment]) => environment),
      plan: evidencePlanOf(plan),
      assignment: 'count',
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      outcomes: outcomes.flat(),
      diagnostics: [
        ...plan.warnings.map((message): EvidenceDiagnostic => ({ severity: 'warn', code: 'plan', message })),
        ...warnings.map((message): EvidenceDiagnostic => ({ severity: 'warn', code: 'workers', message })),
        ...said.flat(),
      ],
      acquisition: { ms: elapsed() - started, subjects: costs },
    };
  } finally {
    await collector.close();
  }
}
