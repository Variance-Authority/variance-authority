// compass: variance-authority.report.shard-merge
import { withDeclaredIn } from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import type { SubjectCoverage, SuiteIndex } from '@variance-authority/report/suite-index';
import type { PlannedSubject } from './collector.js';
import { evidenceFieldsOf, locate } from './collect.js';
import type { EvidenceDiagnostic, EvidencePart, SubjectOutcome } from './evidence-part.js';
import { assign } from './shard.js';
import { composeSuiteIndex, type PartSubject } from './suite-part.js';

/**
 * `variance collect merge`: the parts of every shard of one collection, checked
 * and folded into the index of the whole suite.
 *
 * Nothing is counted until the parts are shown to be one collection: one part
 * per shard of one cut, read from one build under one recipe and one plan, each
 * owning exactly the subjects the cut gives it and saying what became of every
 * one. Then the rows are put back in plan order and composed as if one job had
 * read them all, so the index depends on neither how many jobs there were, nor
 * the order their parts are named in, nor which browser finished first.
 */

/** A part, and the file it was read from, which every refusal names. */
export interface Named {
  readonly path: string;
  readonly part: EvidencePart;
}

export interface FailedSubject {
  readonly subject: string;
  readonly because: string;
  /** The shard to collect again. Absent for an unsharded collection. */
  readonly shard?: { readonly index: number; readonly total: number };
}

export type Merged =
  | {
      readonly kind: 'merged';
      readonly index: SuiteIndex;
      /** Subjects that failed, in plan order. The index is incomplete while any is here. */
      readonly failed: readonly FailedSubject[];
      readonly diagnostics: readonly EvidenceDiagnostic[];
    }
  | { readonly kind: 'refused'; readonly because: string };

export function mergeEvidence(named: readonly Named[]): Merged {
  if (named.length === 0) return { kind: 'refused', because: 'no parts were given' };
  const parts = [...named].sort((left, right) => (left.part.shard?.index ?? 0) - (right.part.shard?.index ?? 0));
  const because = shardsRefusal(parts) ?? sameRefusal(parts) ?? ownershipRefusal(parts) ?? fieldsRefusal(parts);
  if (because !== undefined) return { kind: 'refused', because };
  return { kind: 'merged', ...composed(parts) };
}

/** Step 1: one part per shard of one cut, or one unsharded part. */
function shardsRefusal(parts: readonly Named[]): string | undefined {
  const unsharded = parts.filter((named) => named.part.shard === undefined);
  const sharded = parts.filter((named) => named.part.shard !== undefined);
  if (unsharded.length > 0 && sharded.length > 0) {
    return `${unsharded[0]!.path} is unsharded and ${sharded[0]!.path} is shard ${shardOf(sharded[0]!.part)}; they are not one collection`;
  }
  if (unsharded.length > 1) return `${unsharded[0]!.path} and ${unsharded[1]!.path} are both a whole collection; give one`;
  if (sharded.length === 0) return undefined;

  const totals = [...new Set(sharded.map((named) => named.part.shard!.total))].sort((left, right) => left - right);
  if (totals.length > 1) return `the parts were cut ${totals.map((n) => `${String(n)} ways`).join(' and ')}; they are not one collection`;
  const total = totals[0]!;
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i]!.part.shard!.index === parts[i - 1]!.part.shard!.index) {
      return `shard ${shardOf(parts[i]!.part)} was given twice: ${parts[i - 1]!.path} and ${parts[i]!.path}`;
    }
  }
  const held = new Set(sharded.map((named) => named.part.shard!.index));
  const absent = Array.from({ length: total }, (_, i) => i + 1).filter((index) => !held.has(index));
  if (absent.length > 0) {
    const which = absent.map((index) => `${String(index)}/${String(total)}`);
    return `shard ${which.join(', ')} ${absent.length === 1 ? 'is' : 'are'} missing; collect ${absent.length === 1 ? 'it' : 'them'} with \`variance collect --shard ${which[0]!}\` and merge again`;
  }
  return undefined;
}

const SAME: readonly (readonly [keyof EvidencePart | 'recipe' | 'plan', string, (part: EvidencePart) => unknown])[] = [
  ['build', 'were read from different builds', (part) => part.build],
  ['recipe', 'were read under different recipes', (part) => part.recipe.digest],
  ['plan', 'were cut from different plans', (part) => part.plan.digest],
  ['assignment', 'were cut by different assignments', (part) => part.assignment],
  ['scope', 'were narrowed by different scopes', (part) => part.scope ?? null],
  ['declaredIn', 'scanned different source', (part) => part.declaredIn ?? null],
];

/** Step 2: the same build, recipe, plan, cut and scope in every part. */
function sameRefusal(parts: readonly Named[]): string | undefined {
  const [first, ...rest] = parts;
  for (const [, says, pick] of SAME) {
    const held = canonicalize(pick(first!.part) as CanonicalValue);
    const other = rest.find((named) => canonicalize(pick(named.part) as CanonicalValue) !== held);
    if (other !== undefined) return `${first!.path} and ${other.path} ${says}; they are not one collection`;
  }
  return undefined;
}

/** Step 3: each part owns what the cut gives it, says what became of each, and holds a row for each snapshot. */
function ownershipRefusal(parts: readonly Named[]): string | undefined {
  const entries = parts[0]!.part.plan.subjects;
  const planned = entries.map(
    (entry): PlannedSubject => ({
      subject: { id: entry.id, kind: 'story' },
      ...(entry.viewport === undefined ? {} : { viewport: entry.viewport }),
      ...(entry.declaredIn === undefined ? {} : { declaredIn: entry.declaredIn }),
    }),
  );

  for (const { path, part } of parts) {
    const assignment = assign(planned, part.shard, undefined);
    const owned = new Set(assignment.queue.flat());
    const said = new Map<number, SubjectOutcome>();
    for (const outcome of part.outcomes) {
      const expected = entries[outcome.position]!.id;
      if (outcome.subject !== expected) {
        return `${path} names ${outcome.subject} at position ${String(outcome.position)}, where the plan has ${expected}`;
      }
      if (!owned.has(outcome.position)) {
        const owner = assignment.elsewhere.get(outcome.position) ?? 1;
        return `${path} claims ${outcome.subject}, but shard ${String(owner)}/${String(part.shard?.total ?? 1)} owns it`;
      }
      if (said.has(outcome.position)) return `${path} says twice what became of ${outcome.subject}`;
      said.set(outcome.position, outcome);
    }
    const omitted = [...owned].sort((left, right) => left - right).find((position) => !said.has(position));
    if (omitted !== undefined) {
      return `${path} says nothing of ${entries[omitted]!.id}, which it owns; it is not a whole part — collect ${whichShard(part)} again`;
    }

    const rows = new Set<number>();
    for (const row of part.subjects) {
      const outcome = said.get(row.position);
      if (outcome?.outcome !== 'collected' || !outcome.snapshot || outcome.subject !== row.subject) {
        return `${path} holds a row for ${row.subject} at position ${String(row.position)}, which it did not collect with a snapshot`;
      }
      if (rows.has(row.position)) return `${path} holds two rows for ${row.subject}`;
      rows.add(row.position);
    }
    const rowless = part.outcomes.find((outcome) => outcome.outcome === 'collected' && outcome.snapshot && !rows.has(outcome.position));
    if (rowless !== undefined) return `${path} collected a snapshot of ${rowless.subject} and holds no row for it`;
  }
  return undefined;
}

/** Step 4: the fields a part says it read are the ones its rows and its source imply. */
function fieldsRefusal(parts: readonly Named[]): string | undefined {
  for (const { path, part } of parts) {
    const implied = evidenceFieldsOf(part.subjects.map((row) => row.lexicon), sourced(part));
    if (canonicalize((part.fields ?? null) as CanonicalValue) !== canonicalize((implied ?? null) as CanonicalValue)) {
      return `${path} says it read the fields ${listOf(part.fields)}, and what it holds was read under ${listOf(implied)}`;
    }
    const allowed = new Set<string>(implied ?? []);
    for (const row of part.subjects) {
      const stray = Object.keys(row.lexicon.fields).find((field) => !allowed.has(field));
      if (stray !== undefined) return `${path} holds ${stray} for ${row.subject}, a field it does not say it read`;
    }
  }
  return undefined;
}

function composed(parts: readonly Named[]): Omit<Extract<Merged, { kind: 'merged' }>, 'kind'> {
  const first = parts[0]!.part;
  const located = new Map<string, readonly string[]>();
  for (const { part } of parts) for (const [component, files] of Object.entries(part.located ?? {})) locate(located, component, files);
  const declaredIn = declaredOf(first.declaredIn, located);

  const declared = new Map(Object.entries(declaredIn ?? {}));
  const rows: PartSubject[] = parts
    .flatMap(({ part }) => part.subjects)
    .sort((left, right) => left.position - right.position)
    .map((row) => (declaredIn === undefined ? row : { ...row, lexicon: withDeclaredIn(row.lexicon, row.instances, declared) }));
  const fields = evidenceFieldsOf(
    rows.map((row) => row.lexicon),
    parts.some(({ part }) => sourced(part)),
  );

  const counted = composeSuiteIndex(
    [{ version: 1, planned: first.plan.subjects.length, subjects: rows, ...(fields === undefined ? {} : { fields }), ...(declaredIn === undefined ? {} : { declaredIn }) }],
    first.build.commit ?? '',
  );
  // One part, unsharded, cannot be refused; a string here is a defect in the checks above.
  if (typeof counted === 'string') throw new Error(counted);
  const { commit: _written, ...census } = counted ?? { commit: '', subjects: [], components: [] };

  const outcomes = parts.flatMap(({ part }) => part.outcomes.map((outcome) => ({ outcome, shard: part.shard })));
  outcomes.sort((left, right) => left.outcome.position - right.outcome.position);
  const coverage: SubjectCoverage[] = [
    ...outcomes.map(({ outcome }): SubjectCoverage =>
      outcome.outcome === 'collected'
        ? { subject: outcome.subject, outcome: 'collected' }
        : { subject: outcome.subject, outcome: outcome.outcome, because: outcome.because },
    ),
    ...first.plan.excluded.map((entry): SubjectCoverage => ({ subject: entry.subject, outcome: 'excluded', because: entry.because })),
  ];
  const failed = outcomes.flatMap(({ outcome, shard }): FailedSubject[] =>
    outcome.outcome === 'failed' ? [{ subject: outcome.subject, because: outcome.because, ...(shard === undefined ? {} : { shard }) }] : [],
  );

  const index: SuiteIndex = {
    ...(first.build.commit === undefined ? {} : { commit: first.build.commit }),
    ...census,
    coverage,
    provenance: {
      plan: first.plan.digest,
      recipe: first.recipe.digest,
      assignment: first.assignment.by,
      ...(first.build.storybook === undefined ? {} : { storybook: first.build.storybook }),
      ...(first.build.source === undefined ? {} : { source: first.build.source }),
      ...(first.scope === undefined ? {} : { scope: first.scope }),
    },
  };
  return { index, failed, diagnostics: parts.flatMap(({ part }) => part.diagnostics) };
}

/** The scan, with what the engines located laid over it; keys in code-unit order. */
function declaredOf(
  scan: Readonly<Record<string, readonly string[]>> | undefined,
  located: ReadonlyMap<string, readonly string[]>,
): Record<string, readonly string[]> | undefined {
  if (scan === undefined && located.size === 0) return undefined;
  const merged = { ...scan, ...Object.fromEntries(located) };
  return Object.fromEntries(Object.entries(merged).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

function sourced(part: EvidencePart): boolean {
  return part.declaredIn !== undefined || part.located !== undefined;
}

function shardOf(part: EvidencePart): string {
  return part.shard === undefined ? 'whole' : `${String(part.shard.index)}/${String(part.shard.total)}`;
}

function whichShard(part: EvidencePart): string {
  return part.shard === undefined ? 'it' : `\`--shard ${shardOf(part)}\``;
}

function listOf(fields: readonly string[] | undefined): string {
  return fields === undefined ? 'none' : fields.join(', ');
}
