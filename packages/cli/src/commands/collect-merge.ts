// compass: variance-authority.report.shard-merge
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import type { SubjectCoverage, SuiteIndex } from '@variance-authority/report/suite-index';
import type { EvidenceDiagnostic, EvidencePart } from './evidence-part.js';
import { assign } from './shard.js';
import { composeSuiteIndex, missingShards } from './suite-part.js';

/**
 * `variance collect merge`: the parts of every shard of one collection, checked
 * and composed into the index of the whole suite.
 *
 * Nothing is counted until the parts are shown to be one collection: one part
 * per shard of one cut, read from one build under one recipe and one plan, each
 * owning exactly the subjects the cut gives it and saying what became of every
 * one. Then they are composed as `share` composes a sharded run's parts, so the
 * index depends on neither how many jobs there were, nor the order their parts
 * are named in, nor which browser finished first.
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
  const shards = missingShards(parts.map(({ part }) => part));
  if (shards !== undefined) {
    return { kind: 'refused', because: `${shards}; collect each shard with \`variance collect --shard k/n\` and merge again` };
  }
  const because = sameRefusal(parts) ?? ownershipRefusal(parts) ?? fieldsRefusal(parts);
  if (because !== undefined) return { kind: 'refused', because };
  return composed(parts);
}

const SAME: readonly (readonly [string, (part: EvidencePart) => unknown])[] = [
  ['were read from different builds', (part) => [part.commit ?? null, part.build]],
  ['were read under different recipes', (part) => part.recipe.digest],
  ['were cut from different plans', (part) => part.plan.digest],
  ['were cut by different assignments', (part) => part.assignment],
  ['were narrowed by different scopes', (part) => part.scope ?? null],
];

/** The same build, recipe, plan, cut and scope in every part. */
function sameRefusal(parts: readonly Named[]): string | undefined {
  const [first, ...rest] = parts;
  for (const [says, pick] of SAME) {
    const held = canonicalize(pick(first!.part) as CanonicalValue);
    const other = rest.find((named) => canonicalize(pick(named.part) as CanonicalValue) !== held);
    if (other !== undefined) return `${first!.path} and ${other.path} ${says}; they are not one collection`;
  }
  return undefined;
}

/** Each part says what became of exactly the subjects the cut gives it, at their plan positions. */
function ownershipRefusal(parts: readonly Named[]): string | undefined {
  const entries = parts[0]!.part.plan.subjects;
  const planned = entries.map((entry) => ({ subject: { id: entry.id, kind: 'story' as const }, ...(entry.declaredIn === undefined ? {} : { declaredIn: entry.declaredIn }) }));
  for (const { path, part } of parts) {
    const assignment = assign(planned, part.shard, undefined);
    const owned = new Set(assignment.queue.flat());
    for (const outcome of part.outcomes) {
      const expected = entries[outcome.position]?.id;
      if (outcome.subject !== expected) {
        return `${path} names ${outcome.subject} at position ${String(outcome.position)}, where the plan has ${expected ?? 'nothing'}`;
      }
      if (!owned.has(outcome.position)) {
        const owner = assignment.elsewhere.get(outcome.position) ?? 1;
        return `${path} claims ${outcome.subject}, but shard ${String(owner)}/${String(part.shard?.total ?? 1)} owns it`;
      }
    }
    const said = new Set(part.outcomes.map((outcome) => outcome.position));
    const omitted = [...owned].sort((left, right) => left - right).find((position) => !said.has(position));
    if (omitted !== undefined) return `${path} says nothing of ${entries[omitted]!.id}, which it owns; collect its shard again`;
  }
  return undefined;
}

/** Every field a row holds is one its part says it read. */
function fieldsRefusal(parts: readonly Named[]): string | undefined {
  for (const { path, part } of parts) {
    const read = new Set<string>(part.fields ?? []);
    for (const row of part.subjects) {
      const stray = Object.keys(row.lexicon.fields).find((field) => !read.has(field));
      if (stray !== undefined) return `${path} holds ${stray} for ${row.subject}, a field it does not say it read`;
    }
  }
  return undefined;
}

function composed(parts: readonly Named[]): Merged {
  const first = parts[0]!.part;
  const counted = composeSuiteIndex(
    parts.map(({ part }) => part),
    first.commit ?? '',
  );
  if (typeof counted === 'string') return { kind: 'refused', because: counted };
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
    ...(first.commit === undefined ? {} : { commit: first.commit }),
    ...census,
    coverage,
    provenance: {
      plan: first.plan.digest,
      recipe: first.recipe.digest,
      assignment: first.assignment,
      ...(first.build.storybook === undefined ? {} : { storybook: first.build.storybook }),
      ...(first.build.source === undefined ? {} : { source: first.build.source }),
      ...(first.scope === undefined ? {} : { scope: first.scope }),
    },
  };
  return { kind: 'merged', index, failed, diagnostics: parts.flatMap(({ part }) => part.diagnostics) };
}
