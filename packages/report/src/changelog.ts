import { clusterChanges } from './cluster.js';
import type { RunReport } from './format.js';

/**
 * Why a baseline is what it is — written where the baseline is written.
 *
 * A baseline update happens in a run of its own: `variance accept` promotes the
 * candidates a reviewer looked at, and the artifact that lands is a directory of
 * PNGs, or a row in a review database. Both record *what* the new baseline is.
 * Neither records **what the change was**, and by the time anybody asks — a month
 * later, at the twelfth 2px approval — the report that could have said is gone
 * with the CI job that wrote it.
 *
 * So the explanation is written at the only moment it exists, into the same
 * artifact as the bytes it explains: a commit message where baselines are commits,
 * a row where they are rows. This module is the part neither of those owns — the
 * derivation from a report, and the encoding that survives the trip back.
 *
 * ## The unit is a change, not a screenshot
 *
 * One entry per **cluster** ([`cluster.ts`](./cluster.ts)), because that is
 * already this project's answer to the same question one level up: a token edit
 * across forty stories is one decision, and forty entries would reproduce exactly
 * the review problem clustering exists to solve. A changelog that logged
 * screenshots would be forty lines nobody reads, ending in the same place as a
 * commit message that says `regenerate baselines`.
 *
 * ## Only what was accepted, and only what the report already said
 *
 * The subjects on an entry are the intersection of the cluster with the subjects
 * this command actually promoted — never the cluster's own list. `accept --shape`
 * refuses by name any subject where something else also moved, and an entry that
 * copied the cluster would claim those too. What the shape *reached* is carried
 * as a count beside it, so the shortfall is visible rather than absent.
 *
 * Nothing here re-derives anything from bytes. The entry is built from the report
 * the reviewer read, which is what makes it evidence about a decision rather than
 * a second opinion about an image.
 *
 * ## What a record carries, and what it deliberately does not
 *
 * This outlives everything around it. The report is gone with the CI job, the
 * reviewer has left the project, the file has been renamed twice — and the record
 * is still in the log, being read by somebody who cannot check any of it. So a
 * field belongs here only if it will still mean the same thing then.
 *
 * Three that would not, and are absent:
 *
 * **A pixel count.** It measures *displacement* rather than magnitude — a 1px
 * token edit high on a page moves everything below it — and it is machine-bound
 * on top of that. Two commits carrying `1,180px` and `2,180px` invite a
 * comparison that is not valid between them, which is the same argument that
 * keeps pixels out of the history store.
 *
 * **A rendered sentence.** Drift is carried as `token`, `from`, `to` and a step
 * count, never as the phrasing today's reporter happened to use. Prose in a
 * durable record freezes one wording forever and goes stale against the tool that
 * writes the new one.
 *
 * **Anything derivable.** The accepted total is the entries' subjects plus the
 * ungrouped count. Recording it as well would create two numbers that can
 * disagree after a partial read, and no way to decide which is the record.
 *
 * What stays is what a later reader can still verify or act on: a
 * content-addressed fingerprint they can pass straight back to `accept --shape`,
 * the subject ids it landed in, what the shape reached, and the run and commit it
 * all came from. `component` and `file` stay as *where it was then* — a rename
 * makes them stale, and the fingerprint beside them does not.
 *
 * ## Version 1, and what may be added without a version 2
 *
 * A reader ignores keys it does not know, so a field added later is readable by
 * readers that predate it. The version bumps only when the *meaning* of an
 * existing field changes — that is the case where partly understanding a record
 * is worse than refusing it, and refusing is what a version is for.
 */

/** One change, as it was accepted. */
export interface ChangelogEntry {
  /** The shape digest, as `accept --shape` and an ignore both take it. */
  readonly fingerprint: string;

  /**
   * The component the semantic tier attributed this shape to.
   *
   * Absent means the shape was grouped by silhouette alone — the ephemeral and
   * raster-only paths, where no document survived to name a cause. Surfaced
   * rather than smoothed over, because a later reader asking *what changed in
   * `Card`* must not be answered from a group that never named one.
   */
  readonly component?: string;

  /** A source location for the component, when one was resolved. */
  readonly file?: string;

  /** Accepted subjects this shape landed in, in report order. */
  readonly subjects: readonly string[];

  /**
   * Subjects the shape reached in the run, accepted or not.
   *
   * Equal to `subjects.length` in the ordinary case and larger whenever the
   * command refused part of the cluster. The difference is the part of the change
   * this baseline update did **not** take, and a record that dropped it would read
   * as though the whole shape had been promoted.
   */
  readonly reached: number;

  /**
   * `true` when the semantic tier called this shape a cause somewhere.
   *
   * A claim the run made, recorded as the run's, because it is what the reviewer
   * was shown when they approved. A later tier that would group the same pixels
   * differently does not make this entry wrong; it makes it historical, which is
   * what a changelog is.
   */
  readonly cause: boolean;
}

/** How the subjects to accept were chosen. */
export type ChangelogSelection = 'named' | 'all' | 'shape';

/**
 * A token whose value moved, and how far it has drifted getting there.
 *
 * Four fields and no sentence. The report phrases this finding for a reviewer and
 * phrases it well; storing that phrasing would preserve one release's wording in
 * every commit written under it, and a reader in two years would be reading the
 * output of a reporter nobody runs any more. The facts are what is durable, and
 * whoever prints them can say it however they say it then.
 */
export interface ChangelogDrift {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  /** Value changes behind it. One is not drift; this is never below two. */
  readonly steps: number;
}

/**
 * What one baseline update was.
 *
 * Drift sits on the record rather than on an entry, and that is a join that does
 * not exist rather than a placement preference: drift is keyed by token and a
 * cluster is keyed by fingerprint, and nothing in this project maps one to the
 * other. It is a fact about the run, recorded at the level it is true at.
 */
export interface ChangelogRecord {
  /** Bumped when the stored shape changes in a way an older reader would misread. */
  readonly changelogVersion: 1;
  /** The run whose candidates were promoted. */
  readonly run: string;
  /** The commit that run observed — not the commit this record lands in. */
  readonly commit: string;
  readonly at: string;
  readonly project?: string;
  /** What the run was comparing, in the author's words. */
  readonly intent?: string;

  /**
   * Who accepted, when the surface that recorded it knows.
   *
   * Absent is not "nobody", for the same reason `Approval.by` is optional: the
   * CLI runs on a machine and in CI, and has no identity to offer that would mean
   * anything. A review service that does know one records it.
   */
  readonly by?: string;

  /**
   * How the subjects were chosen.
   *
   * Recorded because `--all` and a named subject are different events wearing one
   * outcome. `--all` accepts changed subjects as well as new ones — unattended,
   * that is baseline regeneration rather than review, and a reader who cannot
   * tell the two apart is reading a record that launders one into the other.
   */
  readonly selection: ChangelogSelection;

  /**
   * Accepted subjects that carried no fingerprint anywhere.
   *
   * Counted, never folded into an entry. A run with no document behind its
   * baseline produces regions with no shape, and inventing a group for them would
   * report a change this record cannot describe as one it can.
   */
  readonly ungrouped: number;

  readonly entries: readonly ChangelogEntry[];
  readonly drift?: readonly ChangelogDrift[];
}

/** Why no record could be made. Never an empty record, which reads as "nothing changed". */
export interface Unrecordable {
  readonly because: string;
}

export interface ChangelogOptions {
  /** The report the reviewer read, and the only source of what changed. */
  readonly report: RunReport;
  /** Subject ids this command actually promoted. */
  readonly accepted: readonly string[];
  /** How those subjects were chosen. See {@link ChangelogRecord.selection}. */
  readonly selection: ChangelogSelection;
  /** ISO 8601. Injected, because nothing in a record may come from a hidden clock. */
  readonly at: string;
  /** The project the record is scoped by, when the operator keeps one. */
  readonly project?: string;
  /** Who accepted. See {@link ChangelogRecord.by}. */
  readonly by?: string;
  /**
   * Entries a caller formed itself, appended after the clustered ones in the
   * order given.
   *
   * Region clustering is one producer of entries, not the definition of one. A
   * change to an interface — an operation whose response lost a field, a named
   * type reached from nine operations — is the same kind of fact this record
   * exists to carry, and it has no rectangle. The alternative was for such a
   * producer to hand `report.observations` a `RegionRecord` with four invented
   * numbers in it, which would give `x`, `y`, `width` and `height` a second
   * meaning and put a fabricated measurement into the one artifact nobody can
   * go back and correct.
   *
   * Appended rather than merged, because merging would need a rule for two
   * producers claiming one fingerprint, and there is no such rule: a fingerprint
   * carries a domain tag inside its digest input (`shape/v1`, `mask/v1`, and
   * whatever a third producer chooses), so two producers cannot collide unless
   * one of them built its digest wrong — and quietly merging is how that stays
   * hidden.
   *
   * `ungrouped` is untouched by these. It counts accepted subjects *this report's
   * regions* could not group, and a producer that never looked at a region has
   * nothing to say about it.
   */
  readonly entries?: readonly ChangelogEntry[];
}

/** `true` when a record was made, rather than a sentence saying why none was. */
export function isRecorded(value: ChangelogRecord | Unrecordable): value is ChangelogRecord {
  return 'changelogVersion' in value;
}

/**
 * Derive the record of one baseline update.
 *
 * Refuses in two cases, and both refusals are the same rule: an entry that cannot
 * be joined to what produced it explains nothing. A report with no `run` names no
 * build, and an acceptance with no subjects promoted nothing — writing either
 * would leave a message in the log that a later reader has to decide how to
 * discount.
 */
export function changelogOf(options: ChangelogOptions): ChangelogRecord | Unrecordable {
  const { report, at, selection } = options;
  const accepted = new Set(options.accepted);

  if (accepted.size === 0) {
    return {
      because:
        'nothing was accepted, so there is no baseline update to explain. A record written here ' +
        'would say a change landed that did not',
    };
  }
  if (report.run === undefined) {
    return {
      because:
        'this report does not say which run produced it, so the record has nothing to point at. ' +
        'Runs name themselves from `--run` and `--commit` or from the CI environment; an id ' +
        'invented here would attribute a baseline to a build that never happened',
    };
  }

  const clustering = clusterChanges(
    report.observations.filter((observation) => accepted.has(observation.subject)),
  );
  const reach = new Map(
    clusterChanges(report.observations).changes.map((change) => [
      change.fingerprint,
      change.subjects.length,
    ]),
  );

  const entries = clustering.changes.map(
    (change): ChangelogEntry => ({
      fingerprint: change.fingerprint,
      ...(change.component !== undefined ? { component: change.component } : {}),
      ...(change.file !== undefined ? { file: change.file } : {}),
      subjects: change.subjects,
      reached: reach.get(change.fingerprint) ?? change.subjects.length,
      cause: change.cause,
    }),
  );

  // Checked here rather than trusted, because these did not come from clustering
  // and nothing upstream of this function guarantees their shape.
  //
  // `reached < subjects.length` is the clause worth defending: it cannot happen,
  // and it is the one that fails quietly if it does. Containment runs one way —
  // a change reaches some set of subjects and `subjects` is that set intersected
  // with what was accepted, and an intersection cannot exceed what it intersects.
  // The case that looks like an exception is a shape spanning two documents where
  // the operator accepts one of them, and that is `reached: 2, subjects: 1`,
  // which is this check passing. Were it ever to happen, `describe` would print a
  // bare count instead of `n/m` and a partial promotion would read as a whole one.
  const given = options.entries ?? [];
  const wrong = given.find(
    (entry) =>
      entry.fingerprint === '' || entry.subjects.length === 0 || entry.reached < entry.subjects.length,
  );
  if (wrong !== undefined) {
    return {
      because:
        'an entry handed to `changelogOf` is not one: it has no fingerprint, no subjects, or ' +
        `reached fewer subjects than it was promoted in (\`${wrong.fingerprint}\`). Refused here ` +
        'rather than written, because a commit message is the one artifact nobody can go back and ' +
        'correct, and `accept --shape` takes that fingerprint as an argument',
    };
  }

  const drift = driftOf(report);

  return {
    changelogVersion: 1,
    run: report.run.id,
    commit: report.run.commit,
    at,
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(report.intent !== undefined ? { intent: report.intent } : {}),
    ...(options.by !== undefined ? { by: options.by } : {}),
    selection,
    ungrouped: clustering.ungrouped.length,
    entries: [...entries, ...given],
    ...(drift.length > 0 ? { drift } : {}),
  };
}

function driftOf(report: RunReport): readonly ChangelogDrift[] {
  return Object.entries(report.drift ?? {})
    .map(([token, record]) => ({
      token,
      from: record.from,
      to: record.to,
      steps: record.steps,
    }))
    // Byte order rather than `localeCompare`, which is the right sort for a list
    // being shown to a person and the wrong one for a list being serialised. This
    // one goes verbatim into a commit message, and `localeCompare` orders by the
    // machine's `LANG` — two runners accepting the same run would write different
    // bytes for the same facts, which is exactly the machine-boundness this
    // record refuses everywhere else.
    .sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
}
