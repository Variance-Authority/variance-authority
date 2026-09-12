import { identityFrom } from '@variance-authority/raster';
import type { D1Like, D1PreparedLike, D1ResultLike, D1Value } from './bindings.js';
import { ReviewError, number, optionalText, text, type Row } from './review-rows.js';
import type { ObservationRecord } from '@variance-authority/report';
import type { BuildSummary, Coverage, DecisionRecord } from './review-types.js';

/**
 * The four aggregates a build listing is made of, and the window they run over.
 *
 * Apart from [`review-read.ts`](./review-read.ts), which turns one row into one
 * view, because everything here is about *many* builds answered in one question.
 * A page of fifty summaries used to be the listing query and then four more per
 * row — 201 statements, issued one after another, each one a subrequest on a
 * Worker — and the three seconds it took were round trips and not query cost.
 * The same four are now `GROUP BY build` aggregates over the window the listing
 * reads, and a page is one `batch`.
 *
 * The shapes here are statements rather than results on purpose. A caller
 * assembles them with whatever else it needs and spends one round trip on the
 * lot; a function that ran its own query could not be batched with anything.
 */

/**
 * Which builds a read is about, as a `WHERE` fragment the aggregates share.
 *
 * The whole point is that a number of *builds* never becomes a number of
 * *parameters*. D1 binds at most 100 values per query, so a listing that named
 * its fifty builds inline would work today and refuse at a page size somebody
 * raises later — the failure arriving as a platform error in a query nobody
 * edited. A page names its window instead, and the aggregates re-derive it from
 * the same index the listing reads.
 */
export interface BuildScope {
  /** A fragment constraining the `build` column of `alias`. */
  where(alias: string): string;
  readonly params: readonly D1Value[];
}

/** The newest `limit` builds of a project, without naming any of them. */
export function newestBuilds(project: string, limit: number): BuildScope {
  return {
    where: (alias) =>
      `${alias}.build IN (SELECT build FROM builds WHERE project = ? ` +
      'ORDER BY at_ms DESC, rowid DESC LIMIT ?)',
    params: [project, limit],
  };
}

/** One build, by id. */
export function oneBuild(build: string): BuildScope {
  return { where: (alias) => `${alias}.build = ?`, params: [build] };
}

/**
 * The four aggregates every summary is built from, as statements to batch.
 *
 * Prepared rather than run, because the caller puts them in the same `batch` as
 * whatever else it is reading — the listing itself, or the eight detail tables
 * of one build. A summary used to cost four round trips *per build*, which made
 * a fifty-build listing 201 statements issued one after another; these are four,
 * whatever the page size is.
 *
 * Every one of them groups by `build`, including the single-build case. A shape
 * that collapsed when it happened to be reading one row would be a second query
 * to keep correct.
 */
export function summaryStatements(
  db: D1Like,
  project: string,
  scope: BuildScope,
): readonly D1PreparedLike[] {
  const bind = (sql: string): D1PreparedLike => db.prepare(sql).bind(project, ...scope.params);

  return [
    bind(
      `SELECT s.build AS build, s.verdict AS verdict, COUNT(*) AS n FROM build_subjects s
        WHERE s.project = ? AND ${scope.where('s')}
        GROUP BY s.build, s.verdict`,
    ),
    // `decided` is how many subjects of this build anybody has answered about.
    // `latestDecisions` used to be called for it and its result then measured by
    // `size` — a join and a map, to reach a number SQL counts — and the build
    // page then called the same function again for the decisions themselves.
    bind(
      `SELECT d.build AS build, COUNT(DISTINCT d.subject) AS n FROM decisions d
        WHERE d.project = ? AND ${scope.where('d')}
        GROUP BY d.build`,
    ),
    // `pending` in SQL rather than by subtraction, because the two lists are not
    // complements: a subject can carry a decision and a verdict nothing pends
    // on, and counting those out of the needing list is what this does.
    bind(
      `SELECT s.build AS build, COUNT(*) AS n FROM build_subjects s
        WHERE s.project = ? AND ${scope.where('s')}
          AND s.verdict IN ('changed', 'new', 'incomparable')
          AND NOT EXISTS (
                SELECT 1 FROM decisions d
                 WHERE d.project = s.project AND d.build = s.build AND d.subject = s.subject)
        GROUP BY s.build`,
    ),
    bind(
      `SELECT o.build AS build, o.kind AS kind, COUNT(*) AS n FROM build_not_observed o
        WHERE o.project = ? AND ${scope.where('o')}
        GROUP BY o.build, o.kind`,
    ),
  ];
}

/** The four results {@link summaryStatements} asks for, in the order it asks for them. */
export interface SummaryCounts {
  readonly verdicts: readonly Row[];
  readonly decided: readonly Row[];
  readonly pending: readonly Row[];
  readonly coverage: readonly Row[];
}

/** Those four results, read out of a batch that begins with them. */
export function summaryCounts(results: readonly D1ResultLike<Row>[]): SummaryCounts {
  return {
    verdicts: results[0]?.results ?? [],
    decided: results[1]?.results ?? [],
    pending: results[2]?.results ?? [],
    coverage: results[3]?.results ?? [],
  };
}

/**
 * One build row against the project's counts, as the summary a page reads.
 *
 * Pure, and that is the change: it performs no I/O and reads only what it is
 * handed, which is what lets a listing of fifty builds and a page about one
 * share four queries instead of issuing four each.
 */
export function summarize(project: string, row: Row, counts: SummaryCounts): BuildSummary {
  const build = text(row, 'build', 'a build');
  const identity = identityFrom(JSON.parse(text(row, 'identity', 'a build')) as unknown);
  if (identity === null) {
    throw new ReviewError(`build "${build}" carries an identity that is not a renderer identity`);
  }

  // Every verdict, including the ones nothing pends on. A map missing a key
  // reports `undefined` where a build genuinely had none, and a review surface
  // that cannot tell "no ignored subjects" from "this build predates ignores" is
  // one an operator has to go to the database to trust.
  const verdicts: Record<ObservationRecord['verdict'], number> = {
    unchanged: 0,
    changed: 0,
    new: 0,
    incomparable: 0,
    ignored: 0,
  };
  for (const entry of counts.verdicts) {
    if (entry['build'] !== build) continue;
    const verdict = text(entry, 'verdict', 'a verdict count') as ObservationRecord['verdict'];
    if (verdict in verdicts) verdicts[verdict] = number(entry, 'n', 'a verdict count');
  }

  const skipped = counts.coverage.filter((entry) => entry['build'] === build);
  const coverage: Coverage = {
    stated: number(row, 'says_not_observed', 'a build') !== 0,
    failed: countOf(skipped, 'failed'),
    excluded: countOf(skipped, 'excluded'),
    unreached: countOf(skipped, 'unreached'),
  };

  const branch = optionalText(row, 'branch', 'a build');
  const intent = optionalText(row, 'intent', 'a build');

  return {
    project,
    build,
    commit: text(row, 'commit', 'a build'),
    at: text(row, 'at', 'a build'),
    identity,
    retention: text(row, 'retention', 'a build') === 'ephemeral' ? 'ephemeral' : 'durable',
    verdicts,
    decided: totalOf(counts.decided, build),
    pending: totalOf(counts.pending, build),
    coverage,
    ...(branch !== undefined ? { branch } : {}),
    ...(intent !== undefined ? { intent } : {}),
  };
}

/** A `GROUP BY build` count read for one build; a build with no row had none. */
function totalOf(rows: readonly Row[], build: string): number {
  const found = rows.find((row) => row['build'] === build);
  return found === undefined ? 0 : number(found, 'n', 'a build count');
}

/**
 * The current decision per subject, from an append-only table.
 *
 * `MAX(seq)` rather than `MAX(at_ms)`: two decisions can share a millisecond, and
 * a tie broken arbitrarily would show a reviewer their earlier answer as the
 * current one. The sequence is the order the rows were written and cannot tie.
 */
export function latestDecisionsStatement(
  db: D1Like,
  project: string,
  build: string,
): D1PreparedLike {
  return db
    .prepare(
      `SELECT d.subject, d.decision, d.decided_by, d.note, d.at
         FROM decisions d
         JOIN (SELECT subject, MAX(seq) AS seq FROM decisions
                WHERE project = ? AND build = ? GROUP BY subject) latest
           ON latest.seq = d.seq
        WHERE d.project = ? AND d.build = ?`,
    )
    .bind(project, build, project, build);
}

/**
 * Those rows, as the map a page indexes by subject.
 *
 * Split from the statement so the read can travel in a batch with the other
 * eight the build page needs. The outer table carries its own `project` and
 * `build` now: the join was correct without them only because `seq` is a
 * globally unique key, which is a property of the schema rather than of this
 * query, and the filter is also what lets `decisions_latest` cover both sides.
 */
export function decisionsFrom(rows: readonly Row[]): ReadonlyMap<string, DecisionRecord> {
  const decisions = new Map<string, DecisionRecord>();
  for (const row of rows) {
    const note = optionalText(row, 'note', 'a decision');
    decisions.set(text(row, 'subject', 'a decision'), {
      decision: text(row, 'decision', 'a decision') === 'approved' ? 'approved' : 'rejected',
      by: text(row, 'decided_by', 'a decision'),
      at: text(row, 'at', 'a decision'),
      ...(note !== undefined ? { note } : {}),
    });
  }
  return decisions;
}

/** One `GROUP BY` row of a counted column, or zero because the group was empty. */
function countOf(rows: readonly Row[], kind: string): number {
  const found = rows.find((row) => row['kind'] === kind);
  return found === undefined ? 0 : number(found, 'n', 'a coverage count');
}
