// compass: variance-authority.report.shard-merge
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LexiconField } from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue, type Viewport } from '@variance-authority/core/format';
import type { Plan } from './collector.js';
import type { PartSubject } from './suite-part.js';

/**
 * What one `variance collect` job read, in a file a merge can check.
 *
 * A suite part beside a run report is trusted because the report beside it was
 * already merged, and the merge of reports refused shards of different builds.
 * A collection has no report, so its part says for itself which build, which
 * recipe, which plan and which cut it belongs to, and what became of every
 * subject it owned. The merge compares those and refuses on any difference
 * before it counts anything.
 *
 * `acquisition` is the one block outside that comparison: it is how long the
 * browser took, and two collections of the same build differ in it every time.
 */

export const EVIDENCE_FORMAT = 'variance-authority-evidence-part';
export const EVIDENCE_VERSION = 1;

/** One planned subject, as much of it as decides what is collected and who owns it. */
export interface PlanEntry {
  readonly id: string;
  readonly viewport?: Viewport;
  /** The file that declares it; subjects of one file are one shard's. */
  readonly declaredIn?: string;
}

export interface EvidencePlan {
  /** sha256 over the entries and exclusions, in plan order. */
  readonly digest: string;
  readonly subjects: readonly PlanEntry[];
  /** Subjects the plan left out before any shard was cut, with the reason. */
  readonly excluded: readonly { readonly subject: string; readonly because: string }[];
}

/** What became of one owned subject. */
export type SubjectOutcome =
  | { readonly position: number; readonly subject: string; readonly outcome: 'collected'; readonly snapshot: boolean }
  | { readonly position: number; readonly subject: string; readonly outcome: 'failed' | 'excluded'; readonly because: string };

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
  /** sha256 over every file of the built Storybook. Absent for a subject list. */
  readonly storybook?: string;
  /** sha256 over `source.dirs` as they are on disk, edits included. Absent with no dirs. */
  readonly source?: string;
}

/** How the evidence was read: everything that changes what a subject yields. */
export interface EvidenceRecipe {
  readonly digest: string;
  readonly reads: CanonicalValue;
}

/** How the plan was cut. Apart from the recipe, so a sharded collection compares to a whole one. */
export interface EvidenceAssignment {
  readonly by: 'checksum';
}

export interface EvidencePart {
  readonly format: typeof EVIDENCE_FORMAT;
  readonly version: typeof EVIDENCE_VERSION;
  readonly build: EvidenceBuild;
  readonly recipe: EvidenceRecipe;
  readonly plan: EvidencePlan;
  readonly shard?: { readonly index: number; readonly total: number };
  readonly assignment: EvidenceAssignment;
  /** `--subjects`, when the collection was narrowed to part of the plan. */
  readonly scope?: string;
  /** One per subject this job owned, in plan order. */
  readonly outcomes: readonly SubjectOutcome[];
  /** The subjects that carried a snapshot, reduced; in plan order. */
  readonly subjects: readonly PartSubject[];
  /** Which lexicon fields these subjects were read under. Absent when none was. */
  readonly fields?: readonly LexiconField[];
  /** Where the source scan says each component is declared. Absent with no `source.dirs`. */
  readonly declaredIn?: Readonly<Record<string, readonly string[]>>;
  /**
   * Where the collector's engine located a component it rendered, which the
   * merge lays over the scan. Of several answers the one whose canonical form
   * sorts first, so neither completion order nor the shard that held it decides.
   */
  readonly located?: Readonly<Record<string, readonly string[]>>;
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
  const excluded = plan.notObserved.map((entry) => ({ subject: entry.subject, because: entry.because }));
  return { digest: planDigest(subjects, excluded), subjects, excluded };
}

function planDigest(subjects: readonly PlanEntry[], excluded: EvidencePlan['excluded']): string {
  return sha256Hex(canonicalize({ subjects, excluded } as unknown as CanonicalValue));
}

/** The digest a recipe is compared by. */
export function recipeOf(reads: CanonicalValue): EvidenceRecipe {
  return { digest: sha256Hex(canonicalize(reads)), reads };
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A part with its timings dropped: what two collections of one build agree on. */
export function semanticOf(part: EvidencePart): Omit<EvidencePart, 'acquisition'> {
  const { acquisition: _timed, ...rest } = part;
  return rest;
}

/** Written through a temporary file, so a reader never opens half of one. */
export async function writeEvidencePart(path: string, part: EvidencePart): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${canonicalize(part as unknown as CanonicalValue)}\n`);
  await rename(temporary, path);
}

/** A part from disk, or why it is not one this version reads. */
export async function readEvidencePart(path: string): Promise<EvidencePart | string> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return `${path} could not be read${code === undefined ? `: ${(error as Error).message}` : ` (${code})`}`;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return `${path} is not JSON`;
  }
  const wrong = malformed(value);
  return wrong === undefined ? (value as EvidencePart) : `${path} is not an evidence part this version reads: ${wrong}`;
}

const FIELDS = new Set<string>(['example', 'names', 'text', 'components', 'createdBy', 'regions', 'files', 'roles', 'tokens']);

/** What is wrong with a value read as a part, or `undefined` when nothing is. */
export function malformed(value: unknown): string | undefined {
  if (!isRecord(value)) return 'it is not an object';
  if (value['format'] !== EVIDENCE_FORMAT) return `its format is ${JSON.stringify(value['format'])}`;
  if (value['version'] !== EVIDENCE_VERSION) return `it is version ${JSON.stringify(value['version'])}, and this reads ${String(EVIDENCE_VERSION)}`;

  const build = value['build'];
  if (!isRecord(build) || !optionalStrings(build, ['commit', 'storybook', 'source'])) return 'its build is malformed';
  const recipe = value['recipe'];
  if (!isRecord(recipe) || typeof recipe['digest'] !== 'string' || !('reads' in recipe)) return 'its recipe is malformed';
  if (sha256Hex(canonicalize(recipe['reads'] as CanonicalValue)) !== recipe['digest']) return 'its recipe does not match its digest';

  const plan = value['plan'];
  if (!isRecord(plan) || typeof plan['digest'] !== 'string' || !Array.isArray(plan['subjects']) || !Array.isArray(plan['excluded'])) {
    return 'its plan is malformed';
  }
  if (!plan['subjects'].every((entry) => isRecord(entry) && typeof entry['id'] === 'string' && optionalStrings(entry, ['declaredIn']))) {
    return 'its plan holds an entry with no id';
  }
  if (!plan['excluded'].every((entry) => isRecord(entry) && typeof entry['subject'] === 'string' && typeof entry['because'] === 'string')) {
    return 'its plan holds an exclusion with no reason';
  }
  const entries = plan['subjects'] as PlanEntry[];
  if (planDigest(entries, plan['excluded'] as EvidencePlan['excluded']) !== plan['digest']) return 'its plan does not match its digest';

  const shard = value['shard'];
  if (shard !== undefined && !validShard(shard)) return `its shard ${JSON.stringify(shard)} is not k/n with 1 ≤ k ≤ n`;
  const assignment = value['assignment'];
  if (!isRecord(assignment) || assignment['by'] !== 'checksum') return 'its assignment is not one this version reads';

  if (!optionalStrings(value, ['scope'])) return 'its scope is malformed';
  const outcomes = value['outcomes'];
  if (!Array.isArray(outcomes) || !outcomes.every((outcome) => validOutcome(outcome, entries.length))) return 'it holds a malformed outcome';
  const subjects = value['subjects'];
  if (!Array.isArray(subjects) || !subjects.every((row) => validRow(row, entries.length))) return 'it holds a malformed subject';

  const fields = value['fields'];
  if (fields !== undefined && !(Array.isArray(fields) && fields.every((field) => FIELDS.has(field as string)))) return 'its fields are malformed';
  for (const key of ['declaredIn', 'located']) {
    const declared = value[key];
    if (declared !== undefined && !(isRecord(declared) && Object.values(declared).every(isStrings))) return `its ${key} is malformed`;
  }
  const diagnostics = value['diagnostics'];
  if (!Array.isArray(diagnostics) || !diagnostics.every(validDiagnostic)) return 'its diagnostics are malformed';
  const acquisition = value['acquisition'];
  if (!isRecord(acquisition) || typeof acquisition['ms'] !== 'number' || !isRecord(acquisition['subjects'])) return 'its timings are malformed';
  return undefined;
}

function validShard(shard: unknown): boolean {
  if (!isRecord(shard)) return false;
  const { index, total } = shard;
  return Number.isInteger(index) && Number.isInteger(total) && (index as number) >= 1 && (index as number) <= (total as number);
}

function validOutcome(outcome: unknown, planned: number): boolean {
  if (!isRecord(outcome) || !validPosition(outcome['position'], planned) || typeof outcome['subject'] !== 'string') return false;
  if (outcome['outcome'] === 'collected') return typeof outcome['snapshot'] === 'boolean';
  return (outcome['outcome'] === 'failed' || outcome['outcome'] === 'excluded') && typeof outcome['because'] === 'string';
}

function validDiagnostic(diagnostic: unknown): boolean {
  return (
    isRecord(diagnostic) &&
    optionalStrings(diagnostic, ['subject']) &&
    (diagnostic['severity'] === 'warn' || diagnostic['severity'] === 'error') &&
    typeof diagnostic['code'] === 'string' &&
    typeof diagnostic['message'] === 'string'
  );
}

function validRow(row: unknown, planned: number): boolean {
  if (!isRecord(row) || !validPosition(row['position'], planned) || typeof row['subject'] !== 'string') return false;
  if (!Array.isArray(row['instances']) || !row['instances'].every((instance) => isRecord(instance) && typeof instance['component'] === 'string')) return false;
  const lexicon = row['lexicon'];
  return (
    isRecord(lexicon) &&
    lexicon['subject'] === row['subject'] &&
    isRecord(lexicon['fields']) &&
    Object.entries(lexicon['fields']).every(([field, values]) => FIELDS.has(field) && isStrings(values)) &&
    Array.isArray(lexicon['landmarks']) &&
    Number.isInteger(lexicon['boundaries'])
  );
}

function validPosition(position: unknown, planned: number): boolean {
  return Number.isInteger(position) && (position as number) >= 0 && (position as number) < planned;
}

function optionalStrings(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => record[key] === undefined || typeof record[key] === 'string');
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
