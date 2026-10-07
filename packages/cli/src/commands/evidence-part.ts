// compass: variance-authority.report.shard-merge
import { digestValue, type CanonicalValue, type EnvironmentInputs, type Viewport } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Plan } from './collector.js';
import type { NotObserved, NotObservedKind } from './run-report.js';
import { openSuitePart, type SuitePart } from './suite-part.js';

/**
 * What one `variance collect` job read: a suite part, and what makes it
 * checkable without a report.
 *
 * A suite part beside a run report is trusted because the report beside it was
 * already merged, and the merge of reports refused shards of different builds.
 * A collection has no report, so its part says for itself which build, which
 * recipe, which plan and which cut it belongs to, and what became of every
 * subject it owned. The merge compares those and refuses on any difference
 * before it composes the parts as `share` composes a run's.
 *
 * `acquisition` is the one block outside that comparison: it is how long the
 * browser took, and two collections of the same build differ in it every time.
 */

/** One planned subject, as much of it as decides what is collected and who owns it. */
export interface PlanEntry {
  readonly id: string;
  readonly viewport?: Viewport;
  /** The file that declares it; subjects of one file are one shard's. */
  readonly declaredIn?: string;
}

export interface EvidencePlan {
  /** The digest of the entries and exclusions, in plan order. */
  readonly digest: string;
  readonly subjects: readonly PlanEntry[];
  /** Subjects the plan did not hand over before any shard was cut, as it said of them. */
  readonly notObserved: readonly NotObserved[];
}

/** What became of one owned subject. */
export type SubjectOutcome =
  | { readonly position: number; readonly subject: string; readonly outcome: 'collected'; readonly snapshot: boolean }
  | { readonly position: number; readonly subject: string; readonly outcome: NotObservedKind; readonly because: string };

export interface EvidenceDiagnostic {
  /** Absent for what the plan or a worker said rather than one subject. */
  readonly subject?: string;
  readonly severity: 'warn' | 'error';
  readonly code: string;
  readonly message: string;
}

/** The bytes the evidence was read from. */
export interface EvidenceBuild {
  readonly commit?: string;
  /** The digest of every file of the built Storybook. Absent for a subject list. */
  readonly storybook?: string;
  /** The digest of `source.dirs` as they are on disk, edits included. Absent with no dirs. */
  readonly source?: string;
}

/** How the evidence was read: everything that changes what a subject yields. */
export interface EvidenceRecipe {
  readonly digest: string;
  readonly reads: CanonicalValue;
}

/**
 * What a snapshot's environment says of the machine that read it, without what
 * each subject sets for itself: its viewport, its conditions, its assets.
 */
export type EvidenceEnvironment = Pick<EnvironmentInputs, 'profile' | 'engine' | 'ruleset' | 'allowlist' | 'fonts' | 'stabilization'>;

/**
 * A suite part, with its build, recipe, plan and cut, and an outcome for every
 * subject it owned. `subjects` holds the ones that carried a snapshot, and
 * `declaredIn` is the scan with what the engine located laid over it.
 */
export interface EvidencePart extends SuitePart {
  readonly build: Omit<EvidenceBuild, 'commit'>;
  readonly recipe: EvidenceRecipe;
  /** Each environment its snapshots were read in, as the engine reported it, once, in canonical order. */
  readonly environments: readonly EvidenceEnvironment[];
  readonly plan: EvidencePlan;
  /** How the plan was cut. Apart from the recipe, so a sharded collection compares to a whole one. */
  readonly assignment: 'checksum';
  /** `--subjects`, when the collection was narrowed to part of the plan. */
  readonly scope?: string;
  /** One per subject this job owned, in plan order. */
  readonly outcomes: readonly SubjectOutcome[];
  /** What the plan, the workers and each subject's reading noticed, in plan order. */
  readonly diagnostics: readonly EvidenceDiagnostic[];
  readonly acquisition: { readonly ms: number; readonly subjects: Readonly<Record<string, number>> };
}

/** The plan as a part carries it, with the digest of exactly that. */
export function evidencePlanOf(plan: Plan): EvidencePlan {
  const subjects = plan.subjects.map((planned): PlanEntry => ({
    id: planned.subject.id,
    ...(planned.viewport === undefined ? {} : { viewport: planned.viewport }),
    ...(planned.declaredIn === undefined ? {} : { declaredIn: planned.declaredIn }),
  }));
  const notObserved = plan.notObserved.map(({ subject, kind, because }): NotObserved => ({ subject, kind, because }));
  return { digest: digestValue({ subjects, notObserved } as unknown as CanonicalValue), subjects, notObserved };
}

/** The environment `inputs` says a subject was read in, as a part carries it. */
export function evidenceEnvironmentOf(inputs: EnvironmentInputs): EvidenceEnvironment {
  const { profile, engine, ruleset, allowlist, fonts, stabilization } = inputs;
  return { profile, engine, ruleset, allowlist, fonts: [...fonts].sort(codeUnitOrder), ...(stabilization === undefined ? {} : { stabilization }) };
}

/** The digest a recipe is compared by. */
export function recipeOf(reads: CanonicalValue): EvidenceRecipe {
  return { digest: digestValue(reads), reads };
}

/** A collection part from disk, or why it is not one this version reads. */
export async function readEvidencePart(path: string): Promise<EvidencePart | string> {
  const what = 'a collection part';
  const part = (await openSuitePart(path, what)) ?? `${path} could not be read (ENOENT)`;
  if (typeof part === 'string') return part;
  const { outcomes, plan, environments } = part as Partial<EvidencePart>;
  return Array.isArray(outcomes) && Array.isArray(plan?.subjects) && Array.isArray(environments)
    ? (part as EvidencePart)
    : `${path} is not ${what} this version reads`;
}
