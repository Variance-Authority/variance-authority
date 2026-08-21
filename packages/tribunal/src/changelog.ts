import { clusterChanges, type ObservationRecord, type RegionRecord } from '@variance-authority/report';
import type { D1Like, D1Value } from './bindings.js';
import { ReviewError, instant, optionalText, text, type Row } from './review-rows.js';

/**
 * Why a baseline in this database is what it is.
 *
 * The other half of the same subsystem the git-LFS backend answers with a commit
 * message. There, the baseline is a commit and the explanation goes in the
 * message; here, the baseline is a row and the explanation goes in a row beside
 * it. Both are read back by asking the store that holds the bytes, which is the
 * only arrangement in which the explanation cannot drift away from the thing it
 * explains.
 *
 * ## Why it copies rather than joins
 *
 * Everything in this table is already in `build_subjects` and `builds` at the
 * moment it is written, and a view over those two would be shorter. It would also
 * be empty after `sweep`: builds expire — that is what a review surface's storage
 * budget is — and the explanation of a baseline has to outlive the build that
 * proposed it by exactly as long as the baseline lasts, which is forever. So the
 * regions, the commit, the intent and the reviewer are **frozen** into the row at
 * the moment of approval, the same way a commit message is frozen into a commit.
 *
 * A row is written only for an **approval**. A rejection is a decision and it is
 * recorded in `decisions`, but no baseline changed, and a changelog that carried
 * rejections would answer *why does this baseline look like this* with entries
 * about baselines that are not there.
 *
 * ## Clustered on the way out, not on the way in
 *
 * One row per approved subject, and the shapes are grouped when somebody reads.
 * Approval here is per subject — a reviewer clicks through a docket rather than
 * running one command over a report — so there is no moment at which a "batch"
 * exists to cluster. Grouping at read time also means a shape approved across
 * three sessions reads as one change, which is what it was.
 */

/** One approved subject, exactly as the build described it. */
export interface ChangelogRow {
  readonly build: string;
  readonly subject: string;
  readonly commit: string;
  readonly intent?: string;
  readonly by: string;
  readonly note?: string;
  readonly at: string;
  /**
   * The regions the build reported, frozen.
   *
   * The only measurement kept, and kept because the fingerprints inside it are
   * what a shape *is* — the grouping is recomputed from these on every read. No
   * aggregate sits beside them: a changed-pixel total measures displacement
   * rather than magnitude and is bound to the machine that rendered it, and a
   * column of them in a permanent table is an invitation to compare two numbers
   * that were never comparable.
   */
  readonly regions: readonly RegionRecord[];
}

/** One change, as it was approved — the same unit the commit-message half uses. */
export interface ChangelogChange {
  readonly fingerprint: string;
  readonly component?: string;
  readonly file?: string;
  /**
   * Approved subjects this shape landed in, most recently approved first.
   *
   * Approval order rather than a sort, and the same order as `by` beside it, so
   * the two lists can be read against each other: the reviewer at the top is the
   * one who approved the subject at the top.
   */
  readonly subjects: readonly string[];
  /** The builds the approvals came from, newest first. */
  readonly builds: readonly string[];
  /** Everyone who approved part of this shape, most recent first. */
  readonly by: readonly string[];
  /** The most recent approval in the group. */
  readonly at: string;
  readonly intent?: string;
  readonly note?: string;
}

export interface TribunalChangelog {
  readonly changes: readonly ChangelogChange[];
  /**
   * Approved subjects no shape could group.
   *
   * A run that attributed nothing — the ephemeral and raster-only paths — still
   * approved something, and counting it is how the total stays a total. Dropping
   * these would make a changelog that covers eleven of forty approvals look like
   * a changelog of eleven approvals.
   */
  readonly ungrouped: readonly ChangelogRow[];
}

export interface TribunalChangelogQuery {
  /** Substring, case-insensitive, against the component a shape was attributed to. */
  readonly component?: string;
  /** Exact, because a subject id is exact. */
  readonly subject?: string;
  /** Rows to read, newest first. Defaults to 500. */
  readonly limit?: number;
  /** Only approvals at or after this instant. ISO 8601. */
  readonly since?: string;
}

const DEFAULT_LIMIT = 500;

/**
 * Freeze the explanation of one approval.
 *
 * Called from `decide` after the promotion and before the decision row, in the
 * same order and for the same reason: the promotion is the thing with a
 * consequence, and a changelog entry for a baseline that was never written would
 * be an explanation of nothing.
 *
 * Never invents a build's `commit` or `intent` — both come from the build row the
 * approval is about, and a build that cannot be read is a refusal in `promote`
 * long before this runs.
 */
export async function recordApproval(
  db: D1Like,
  project: string,
  input: {
    readonly build: string;
    readonly subject: string;
    readonly by: string;
    readonly note?: string;
    readonly at: string;
    readonly commit: string;
    readonly intent?: string;
    readonly regions: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO changelog
         (project, build, subject, "commit", intent, decided_by, note, regions, at, at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      project,
      input.build,
      input.subject,
      input.commit,
      input.intent ?? null,
      input.by,
      input.note ?? null,
      input.regions,
      input.at,
      instant(input.at, 'an approval'),
    )
    .run();
}

/**
 * Every baseline this project has promoted, grouped by what changed.
 *
 * The filters narrow what is *read*, never what is explained: `--subject` selects
 * rows and then the shapes those rows carry are grouped whole, so a shape
 * approved in forty subjects still reports forty when you ask about one of them.
 * Answering with a group of one would say the change was smaller than it was.
 */
export async function readChangelog(
  db: D1Like,
  project: string,
  query: TribunalChangelogQuery = {},
): Promise<TribunalChangelog> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const conditions = ['project = ?'];
  const bindings: D1Value[] = [project];

  if (query.subject !== undefined) {
    conditions.push('subject = ?');
    bindings.push(query.subject);
  }
  if (query.since !== undefined) {
    conditions.push('at_ms >= ?');
    bindings.push(instant(query.since, 'a changelog window'));
  }

  const found = await db
    .prepare(
      `SELECT * FROM changelog WHERE ${conditions.join(' AND ')} ORDER BY at_ms DESC, seq DESC LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Row>();

  const rows = found.results.map(toRow);
  const clustering = clusterChanges(rows.map(toObservation));

  const bySubject = new Map(rows.map((row) => [row.subject, row]));
  const grouped = new Set<string>();
  const changes: ChangelogChange[] = [];

  for (const change of clustering.changes) {
    const members = change.subjects
      .map((subject) => bySubject.get(subject))
      .filter((row): row is ChangelogRow => row !== undefined);
    if (members.length === 0) continue;
    if (
      query.component !== undefined &&
      !(change.component ?? '').toLowerCase().includes(query.component.toLowerCase())
    ) {
      continue;
    }

    for (const member of members) grouped.add(member.subject);
    // Newest first, matching the row order the query asked for: the reader is
    // looking at a history, and the top of it is where they are.
    const newest = members.reduce((a, b) => (a.at >= b.at ? a : b));

    changes.push({
      fingerprint: change.fingerprint,
      ...(change.component !== undefined ? { component: change.component } : {}),
      ...(change.file !== undefined ? { file: change.file } : {}),
      subjects: members.map((member) => member.subject),
      builds: [...new Set(members.map((member) => member.build))],
      by: [...new Set(members.map((member) => member.by))],
      at: newest.at,
      ...(newest.intent !== undefined ? { intent: newest.intent } : {}),
      ...(newest.note !== undefined ? { note: newest.note } : {}),
    });
  }

  changes.sort((a, b) => (a.at === b.at ? 0 : a.at > b.at ? -1 : 1));

  return {
    changes,
    // Only when nothing narrowed the grouping. Under `--component` an ungrouped
    // row is not "a change no shape explained", it is a row the filter is not
    // about, and listing it would answer a question nobody asked.
    ungrouped:
      query.component === undefined ? rows.filter((row) => !grouped.has(row.subject)) : [],
  };
}

/** A stored row, validated rather than cast. */
function toRow(row: Row): ChangelogRow {
  const regions: unknown = JSON.parse(text(row, 'regions', 'a changelog entry'));
  if (!Array.isArray(regions)) {
    throw new ReviewError('a changelog entry has a `regions` that is not a list');
  }

  const intent = optionalText(row, 'intent', 'a changelog entry');
  const note = optionalText(row, 'note', 'a changelog entry');

  return {
    build: text(row, 'build', 'a changelog entry'),
    subject: text(row, 'subject', 'a changelog entry'),
    commit: text(row, 'commit', 'a changelog entry'),
    by: text(row, 'decided_by', 'a changelog entry'),
    at: text(row, 'at', 'a changelog entry'),
    regions: regions as readonly RegionRecord[],
    ...(intent !== undefined ? { intent } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/**
 * A row, in the shape the clustering already understands.
 *
 * The verdict and the sentence are the row's own fact — it is here because
 * somebody approved a change — rather than a reconstruction of what the run said.
 * `clusterChanges` reads subjects and regions and nothing else, so nothing about
 * the rest of this shape can affect a grouping.
 */
function toObservation(row: ChangelogRow): ObservationRecord {
  return {
    subject: row.subject,
    verdict: 'changed',
    because: `approved by ${row.by}`,
    // Summed from the regions rather than stored beside them. `ObservationRecord`
    // asks for a total because a report has one; this is the arithmetic that
    // produced it, and doing it here keeps the stored row down to what it should
    // outlive its build carrying.
    changedPixels: row.regions.reduce((total, region) => total + region.pixels, 0),
    regions: row.regions,
  };
}
