import type { Diagnostic } from '@variance-authority/core/format';
import type { NotObserved, ObservationRecord, RunReport } from '@variance-authority/report';
import { readRunReport, writeRunReport } from '@variance-authority/report/file';

/**
 * The artifact a run leaves behind: its shape, and the reader that refuses a
 * malformed one.
 *
 * Separated from the command because these two halves have to agree and are
 * written months apart. Every field below exists to keep *absent* apart from
 * *empty* — a reader must be able to tell "no subjects were skipped" from "the
 * writer never said", because only one of those supports the sentence "nothing
 * needs review" — and the validation at the bottom is what stops a hand-edited
 * report from quietly losing that distinction during a triage.
 *
 * The types are supersets of `@variance-authority/report`'s rather than changes
 * to them, so every MCP tool reads a CLI report unmodified.
 */

/**
 * Why a subject is in the report without an observation.
 *
 * Re-exported rather than restated. Two declarations of a closed vocabulary are
 * two things that can gain a third word separately, and the run writes through
 * this one while every reader downstream checks the other.
 */
export type { NotObserved, NotObservedKind } from '@variance-authority/report';

/**
 * The one exclusion that is not a decision: a subject another shard was to take.
 *
 * `--subjects` narrows a run to a slice and records every subject outside it as
 * `excluded`, which is the truth about *that* run and a lie about the suite —
 * nobody chose to stop watching those components, they are simply somebody
 * else's shard. Reading it as a decision is what would let a sharded suite lose a
 * subject in silence: excluded everywhere, red nowhere.
 *
 * So the sentence is built here and recognized here, and both `run` and `merge`
 * go through it. A prefix match on prose is normally a mistake; it is sound in
 * this one case because the writer of the prose is the reader of it, in the same
 * package, and the check below is what keeps them from drifting apart.
 */
const SHARD_FILTER = 'did not match --subjects ';

export function shardFilterBecause(glob: string): string {
  return `${SHARD_FILTER}${glob}`;
}

/** Whether an entry is another shard's subject rather than a decision. */
export function isShardFilter(entry: NotObserved): boolean {
  return entry.kind === 'excluded' && entry.because.startsWith(SHARD_FILTER);
}

/**
 * The run report as this CLI writes it: `RunReport` plus the coverage it cannot
 * express.
 *
 * A superset rather than a change to `@variance-authority/report`'s type, so an MCP
 * server reads a CLI report unmodified and every tool in that package keeps
 * working. The extra fields are the two things a *command line* has to answer and
 * an agent's question does not: what was skipped, and what the index complained
 * about on the way in.
 */
export interface CliRunReport extends RunReport {
  readonly observations: readonly CliObservationRecord[];

  /**
   * Subjects with no observation. **Absent is not empty** — see `exitFor`.
   *
   * Optional in the type only because a report written by something other than
   * this CLI will not have it, and the reader must be able to tell "none" from
   * "the writer never said".
   */
  readonly notObserved?: readonly NotObserved[];

  /** Complaints from the subject index that belong to no single subject. */
  readonly warnings?: readonly string[];

  /**
   * Stabilization tricks the collectors applied before reading anything.
   *
   * The run's own answer to contract 2 — *declare what you did* — for the one
   * thing this tool does to an application that is not reading it. A subject
   * whose fade-in was captured at its first frame is a correct observation of a
   * page that was altered to be observable, and a report that shows the image
   * without saying so is a report whose reader was handed a picture nobody
   * described.
   *
   * Absent means no collector reported stabilizing, which is a real state: a
   * jsdom collection has nothing to hold still, and a hand-written collector may
   * simply not do it.
   */
  readonly stabilization?: readonly string[];
}

/**
 * An observation, plus what the collection of that subject could not do.
 *
 * A superset for the same reason `CliRunReport` is one: every MCP tool keeps
 * working on a CLI report unmodified, and this field can be added without a
 * cross-package change. It belongs on the record rather than in the run's
 * `warnings` because a diagnostic is *about a subject* — the reader's next
 * question is always "which one", and a list of prose with no subject attached
 * cannot answer it.
 *
 * **Why this is not folded into the verdict.** A subject whose design system is
 * served from a cross-origin `<link>` is collected without those rules on both
 * sides of the comparison, so the two images genuinely agree and `unchanged` is
 * the truth about the pixels. Calling it `changed` would be a lie about the
 * comparison, and calling the run clean would be a lie about the coverage. So the
 * verdict stays honest and `exitFor` reads this instead.
 */
export interface CliObservationRecord extends ObservationRecord {
  /**
   * Everything the collector and the normalizer complained about, once each.
   *
   * Optional so absence keeps meaning "the writer never said" rather than
   * "nothing was wrong", which is the same distinction `notObserved` draws and
   * for the same reason.
   */
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * Read a report this CLI (or something else) wrote.
 *
 * The version check is `readRunReport`'s, deliberately not repeated: one place
 * decides what a run report is. What is added is the coverage list, validated
 * rather than trusted, and *absent is preserved as absent* — a reader must be
 * able to tell "no subjects were skipped" from "the writer never said", because
 * only one of those supports the sentence "nothing needs review".
 */
export async function readCliRunReport(path: string): Promise<CliRunReport> {
  const raw = (await readRunReport(path)) as RunReport & {
    readonly notObserved?: unknown;
    readonly warnings?: unknown;
  };
  const { notObserved: rawNotObserved, warnings: rawWarnings, ...base } = raw;

  checkDiagnostics(path, base.observations);

  if (rawWarnings !== undefined && !isStringArray(rawWarnings)) {
    throw new Error(`${path} has a \`warnings\` field that is not an array of strings`);
  }
  const warnings: readonly string[] | undefined = rawWarnings;

  if (rawNotObserved === undefined) {
    return { ...base, ...(warnings !== undefined ? { warnings } : {}) };
  }

  if (!Array.isArray(rawNotObserved)) {
    throw new Error(`${path} has a \`notObserved\` field that is not an array`);
  }

  const notObserved = (rawNotObserved as readonly unknown[]).map((entry, index) => {
    const row = entry as Partial<NotObserved>;
    if (typeof row.subject !== 'string' || typeof row.because !== 'string') {
      throw new Error(`${path}: notObserved[${index}] has no \`subject\` and \`because\``);
    }
    if (row.kind !== 'excluded' && row.kind !== 'failed' && row.kind !== 'unreached') {
      // Not defaulted. Guessing `excluded` would turn a coverage hole into a
      // decision somebody made, guessing `failed` would turn every deliberate
      // exclusion into a permanently red build, and guessing `unreached` would
      // credit the run with reasoning it never did.
      throw new Error(
        `${path}: notObserved[${index}].kind is ${JSON.stringify(row.kind)}, ` +
          'which is none of "excluded", "failed" or "unreached"',
      );
    }
    return { subject: row.subject, kind: row.kind, because: row.because };
  });

  return { ...base, notObserved, ...(warnings !== undefined ? { warnings } : {}) };
}

/** The default report writer. Shares `writeRunReport`'s on-disk shape by using it. */
export async function writeCliRunReport(path: string, report: CliRunReport): Promise<void> {
  await writeRunReport(path, report);
}

/**
 * Refuse an observation whose diagnostics are not diagnostics.
 *
 * Checked at the read boundary for the same reason `notObserved` is, and with a
 * sharper edge: `exitFor` withholds a clean exit while an `error` diagnostic is
 * present, so an entry whose severity survived parsing as something else is a
 * complaint that silently stops holding the run open. A report is also a file
 * people edit by hand when triaging, which is exactly when this happens.
 *
 * Only the fields the decision rests on are checked, and the entries themselves
 * are passed through untouched — rebuilding them would drop whatever a future
 * writer added, and the `report --format json` output is documented to round-trip.
 */
function checkDiagnostics(path: string, observations: readonly unknown[]): void {
  observations.forEach((observation, index) => {
    const value: unknown = (observation as { readonly diagnostics?: unknown }).diagnostics;
    if (value === undefined) return;

    if (!Array.isArray(value)) {
      throw new Error(`${path}: observations[${index}].diagnostics is not an array`);
    }

    (value as readonly unknown[]).forEach((entry, position) => {
      const row = entry as Partial<Diagnostic>;
      const at = `${path}: observations[${index}].diagnostics[${position}]`;

      if (row.severity !== 'warn' && row.severity !== 'error') {
        // Not defaulted in either direction. Reading an unknown severity as `warn`
        // would let a hole in the coverage exit `0`; reading it as `error` would
        // hold every run open on a field somebody spelled wrong.
        throw new Error(
          `${at}.severity is ${JSON.stringify(row.severity)}, ` +
            'which is neither "warn" nor "error"',
        );
      }
      if (typeof row.code !== 'string' || typeof row.message !== 'string') {
        throw new Error(`${at} has no \`code\` and \`message\``);
      }
    });
  });
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * The subjects this run is about, or nothing when there is no run to ask.
 *
 * A missing report is the ordinary state of a checkout nobody has run yet, and
 * it is not the same claim as a run with no subjects — so it comes back absent
 * and `journeys` says which pool it fell back to. A report that *exists* and
 * cannot be read still throws: something wrote it, and reading the accumulated
 * record instead would answer a different question under the same heading.
 *
 * `notObserved` counts. A subject the run planned and skipped is one of this
 * run's subjects, and the journal may well hold a whole recording of it from
 * the last run that did paint it.
 */
export async function subjectsInReport(path: string): Promise<readonly string[] | undefined> {
  let report: CliRunReport;
  try {
    report = await readCliRunReport(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined;
    throw error;
  }

  return [
    ...report.observations.map((observation) => observation.subject),
    ...(report.notObserved ?? []).map((entry) => entry.subject),
  ];
}
