import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Raster } from '@variance-authority/core';
import type { HistoryStore } from '@variance-authority/history';
import type { RasterStore } from '@variance-authority/raster';
import type { ObservationRecord } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
import type { CliRunReport } from './run.js';

/**
 * `variance accept` — record that a change became the baseline.
 *
 * The command is small and the rule behind it is not: **acceptance promotes an
 * image the run already produced, and never produces one.** A version of this
 * that re-rendered would be re-rendering *here*, days later, possibly on another
 * machine — and would then write that image as the baseline. The subject would be
 * re-based against a render nobody reviewed, and the identity partition that
 * makes durable comparison sound (ADR-0011) would have been crossed by the one
 * command whose whole job is to write into it.
 *
 * So: no browser, no renderer, no document. The inputs are a report and the files
 * it points at, and if the run did not leave an image, this refuses by name and
 * says what to do instead. A refusal is cheap; a baseline recorded from an
 * unreviewed render is permanent and invisible.
 *
 * ## The sidecar
 *
 * A baseline is not bytes. It is bytes plus the identity that painted them, the
 * dimensions, the fonts that were missing, and the digest of the document they
 * came from — the last of which is what lets a later run settle the subject
 * without rendering (see `settle`). None of that is in the report, so the run
 * writes it beside the image as `<name>.json`, in the same pairing the durable
 * store itself uses. A candidate whose sidecar is missing is refused rather than
 * reconstructed: an invented digest would settle every future run to `unchanged`
 * against an image nobody can reproduce.
 *
 * ## What it records, and what it still cannot
 *
 * It records the **acceptance**, and nothing else: one row per `(subject, run)`
 * saying somebody approved what that run proposed for that subject. It does not
 * write observations, because a report carries pixels and regions and the
 * per-component hashes are not in it and cannot be derived from it — a row with
 * fabricated hashes would corrupt every later drift question.
 *
 * That split is what makes both halves possible. The run writes the hashes and
 * cannot know whether anybody agreed; this command knows somebody agreed and
 * cannot know the hashes. Joining them is the store's job, on `(subject, run)`,
 * which is exactly the decision a reviewer makes — and until this existed every
 * observation was `accepted: false` forever, so drift, which sums only approved
 * changes, summed nothing at all.
 *
 * A report with no `run` cannot be joined to anything, so nothing is recorded and
 * the result says so. An invented id would attach somebody's approval to a build
 * that never happened.
 */

export interface AcceptOptions {
  readonly report: CliRunReport;
  /** Directory the report's relative image paths resolve against. */
  readonly reportDir: string;
  readonly store: RasterStore;
  /** Subject ids named on the command line. Ignored when {@link all} is set. */
  readonly subjects: readonly string[];
  readonly all: boolean;

  /**
   * Difference shapes to accept wherever they are the *whole* change.
   *
   * The bulk path, and the reason it is safe: a shape names what changed rather
   * than which screenshots it landed in, so accepting one covers every subject
   * it reached — and a subject where something *else* also moved is refused by
   * name instead of being swept along. That refusal is the feature. "One accept
   * across forty screenshots" is only better than forty accepts if the forty
   * were genuinely the same change, and this is the only way to be sure.
   *
   * A fingerprint is copied out of a report; every region carries its own
   * (ADR-0025).
   */
  readonly shapes?: readonly string[];
  /** Reads a candidate image and its sidecar. Injected so this is testable on no disk. */
  readonly read: CandidateReader;

  /**
   * Where the acceptance is recorded, when the operator keeps a history.
   *
   * Absent means no record is kept, which is not a failure and not a warning: the
   * baseline on disk is the acceptance that governs the next run, and this row is
   * the part nobody asked for.
   */
  readonly history?: HistoryStore;

  /** The project rows are scoped by. Required whenever `history` is present. */
  readonly project?: string;

  /** ISO 8601. Injected, because nothing in a report may come from a hidden clock. */
  readonly now?: () => string;
}

export type CandidateReader = (pngPath: string) => Promise<Raster>;

export interface Accepted {
  readonly subject: string;
  /** The image that became the baseline, as the report named it. */
  readonly from: string;
}

export interface Refused {
  readonly subject: string;
  readonly because: string;
}

export interface AcceptResult {
  readonly accepted: readonly Accepted[];
  readonly refused: readonly Refused[];
  /**
   * Subjects `--all` passed over because they already are the baseline.
   *
   * Counted rather than listed, and counted rather than omitted: "accepted 2"
   * over a 300-subject run reads as though 298 were ignored for some reason.
   */
  readonly alreadyBaseline: number;

  /**
   * What the history record was told, or why it was told nothing.
   *
   * Present only when a store is configured. `recorded` counts the subjects whose
   * acceptance was written; `because` is there when none could be, and it is
   * printed rather than swallowed — a record that silently stops receiving
   * approvals reports every reviewed change as unreviewed, and every drift total
   * over that window drops to zero with nothing to say why.
   */
  readonly approvals?: {
    readonly recorded: number;
    readonly because?: string;
  };
}

export async function accept(options: AcceptOptions): Promise<AcceptResult> {
  const { report } = options;
  const accepted: Accepted[] = [];
  const refused: Refused[] = [];
  let alreadyBaseline = 0;

  if (!options.all && (options.shapes ?? []).length === 0 && options.subjects.length === 0) {
    throw new OperatorError(
      'name at least one subject, or pass --all. Accepting nothing is not the same as ' +
        'accepting everything, and this command will not guess which was meant.',
    );
  }

  const shapes = new Set(options.shapes ?? []);
  let targets: readonly ObservationRecord[];

  if (options.all) {
    targets = report.observations;
  } else if (shapes.size > 0) {
    const selected = selectByShape(report.observations, shapes);

    if (selected.whole.length === 0 && selected.partial.length === 0) {
      // Distinct from "nothing was accepted". A fingerprint is pasted from a
      // report, and the overwhelmingly likely cause of no match at all is that
      // it came from a different run — which is worth saying, because the
      // operator can check it.
      throw new OperatorError(
        `the shape(s) ${[...shapes].join(', ')} appear in no region of this run. ` +
          'A fingerprint is copied from a region in a report; check it came from this one.',
      );
    }

    // Named, not silently skipped. These are subjects the operator was thinking
    // about — the shape is in them — and being told which ones were left behind
    // is the difference between a bulk accept and a bulk surprise.
    for (const observation of selected.partial) {
      refused.push({
        subject: observation.subject,
        because:
          observation.truncated !== undefined && observation.truncated.regions > 0
            ? `this shape is present, but the run capped its region list ` +
              `(${observation.truncated.regions} more, ${observation.truncated.pixels}px), so ` +
              'there is no evidence it is the whole change; accept this subject by name'
            : 'this shape is present and something else changed too, so accepting it here ' +
              'would baseline that as well; accept this subject by name once you have read it',
      });
    }

    targets = selected.whole;
  } else {
    targets = options.subjects.map((subject) => find(report, subject));
  }

  for (const observation of targets) {
    // A verdict of `unchanged` normally means there is nothing to promote. An
    // unstable unchanged subject is the exception: `--flakes` reached the same
    // baseline twice and found two readings. Calling it "already the baseline"
    // hides the diagnostic that made the command refuse it.
    if (observation.unstable !== undefined && observation.unstable.absorbed === undefined) {
      refused.push({
        subject: observation.subject,
        because:
          `${observation.unstable.because}. Accepting it would promote one of two readings ` +
          'as the baseline; fix what moves between them, or re-run once it is fixed',
      });
      continue;
    }

    if (observation.verdict === 'unchanged') {
      // Under `--all` this is the overwhelming majority and is not a finding.
      // Named explicitly, it is worth a sentence: the operator asked for
      // something that would do nothing, and silence would look like success.
      if (options.all) alreadyBaseline += 1;
      else {
        refused.push({
          subject: observation.subject,
          because: 'it did not change, so it already is the baseline; nothing to accept',
        });
      }
      continue;
    }

    if (observation.alone?.reproduced === false) {
      refused.push({
        subject: observation.subject,
        because:
          `${observation.alone.because}. Accepting it would make the leak the baseline; ` +
          'fix the subject that writes the shared state, or re-run once it is fixed',
      });
      continue;
    }

    const after = observation.images?.after;
    if (after === undefined) {
      refused.push({ subject: observation.subject, because: noImage(observation) });
      continue;
    }

    const path = resolve(options.reportDir, after);
    let raster: Raster;
    try {
      raster = await options.read(path);
    } catch (error) {
      refused.push({
        subject: observation.subject,
        because: `its candidate image could not be read (${messageOf(error)}); this command ` +
          'never re-renders, so there is nothing to fall back to',
      });
      continue;
    }

    await options.store.put({ subject: observation.subject }, raster);
    accepted.push({ subject: observation.subject, from: after });
  }

  return {
    accepted,
    refused,
    alreadyBaseline,
    ...(options.history === undefined
      ? {}
      : { approvals: await recordApprovals(options, accepted) }),
  };
}

/**
 * Tell the record that somebody agreed, for the subjects that were promoted.
 *
 * Only the subjects actually accepted here. A subject that was already the
 * baseline was approved by whoever made it one, in the run that produced it, and
 * re-approving it under *this* run's id would attach a decision to a build that
 * never proposed the change.
 *
 * Never throws. A history service that is down must not leave a promoted baseline
 * behind a failed command — the image is already written, and a caller that
 * retried would find every subject already the baseline and record nothing at
 * all. So the failure is a sentence in the result.
 */
async function recordApprovals(
  options: AcceptOptions,
  accepted: readonly Accepted[],
): Promise<NonNullable<AcceptResult['approvals']>> {
  const { report, project, history } = options;

  if (history === undefined || project === undefined) {
    return { recorded: 0, because: 'no history store is configured, so nothing was recorded' };
  }
  if (accepted.length === 0) return { recorded: 0 };
  if (report.run === undefined) {
    return {
      recorded: 0,
      because:
        'this report does not say which run produced it, so the acceptance has nothing to point ' +
        'at and was not recorded. Runs name themselves from `--run` and `--commit` or from the ' +
        'CI environment; an id invented here would attach an approval to a build that never ' +
        'happened',
    };
  }

  const at = (options.now ?? ((): string => new Date().toISOString()))();
  const runId = report.run.id;

  try {
    await history.approve(
      accepted.map((entry) => ({ project, subject: entry.subject, run: runId, at })),
    );
    return { recorded: accepted.length };
  } catch (error) {
    return {
      recorded: 0,
      because:
        `the acceptance was not recorded: ${error instanceof Error ? error.message : String(error)}. ` +
        'The baselines were promoted and are on disk; what is missing is the row that would let a ' +
        'later drift question count these changes as approved',
    };
  }
}

/**
 * Why a subject has no image, phrased around what to do next.
 *
 * The two causes are opposite and a single message would serve neither. A
 * settlement means nothing was rendered *because nothing needed to be*; an
 * incomparable baseline means the comparison was refused, and the fix is a
 * decision about machines rather than about this subject.
 */
function noImage(observation: ObservationRecord): string {
  if (observation.verdict === 'incomparable') {
    return (
      'its baseline belongs to another machine, so the run refused to compare and produced ' +
      'no image. Delete that baseline and re-run here to record one for this machine, or ' +
      'run where the baseline was written — accepting across identities is the failure the ' +
      'partition exists to prevent'
    );
  }
  return (
    'the run recorded no image for it. Re-run on this machine so the candidate exists; ' +
    'this command promotes an image that was already reviewed and never renders one'
  );
}

/** The default reader: the PNG, plus the sidecar the run wrote beside it. */
export async function readCandidate(pngPath: string): Promise<Raster> {
  const jsonPath = `${pngPath.replace(/\.png$/, '')}.json`;
  const [meta, bytes] = await Promise.all([readFile(jsonPath, 'utf8'), readFile(pngPath)]);

  const parsed = JSON.parse(meta) as Partial<Raster>;
  if (parsed.identity === undefined || parsed.documentDigest === undefined) {
    // A baseline with no identity cannot be partitioned and a baseline with no
    // document digest can never settle a later run without rendering. Both are
    // silent failures months later, so they are loud ones now.
    throw new Error(
      `${jsonPath} is not a raster sidecar: it has no \`identity\` and \`documentDigest\``,
    );
  }

  return { ...(parsed as Omit<Raster, 'bytes'>), bytes: bytes.toString('base64') };
}

/** The acceptance, as the operator reads it. Every subject named is accounted for. */
export function formatAcceptance(result: AcceptResult): string {
  const lines = [
    `accepted ${result.accepted.length} subject(s)` +
      (result.alreadyBaseline > 0
        ? `, ${result.alreadyBaseline} already the baseline`
        : '') +
      (result.refused.length > 0 ? `, refused ${result.refused.length}` : ''),
    ...result.accepted.map((entry) => `  [accepted] ${entry.subject} — ${entry.from}`),
    ...result.refused.map((entry) => `  [refused]  ${entry.subject}: ${entry.because}`),
    // Printed whenever a store was configured, including the successful case: an
    // operator who set one up should be able to see it working without opening
    // the database, and the sentence for a failure has to land somewhere.
    ...(result.approvals === undefined
      ? []
      : [
          result.approvals.because === undefined
            ? `  recorded ${result.approvals.recorded} acceptance(s) in the history record`
            : `  history: ${result.approvals.because}`,
        ]),
  ];
  return lines.join('\n');
}

/**
 * Split the run by what the named shapes explain: all of a subject, or part of it.
 *
 * *All*, not *any*, is the safety property the whole flag rests on. A subject
 * where the accepted shape appears alongside something else is not a subject
 * where the accepted change is what happened, and promoting it would baseline
 * the other thing silently — the failure a bulk accept is most likely to cause
 * and the one nobody would find afterwards.
 *
 * The partial set is returned rather than discarded because those subjects are
 * the ones the operator was thinking about. Being told which were left behind is
 * the difference between a bulk accept and a bulk surprise.
 *
 * A subject with no regions is in neither set: there is no evidence about what
 * changed in it, and `--all` remains the way to accept a change nothing could
 * attribute.
 */
function selectByShape(
  observations: readonly ObservationRecord[],
  shapes: ReadonlySet<string>,
): { whole: readonly ObservationRecord[]; partial: readonly ObservationRecord[] } {
  const whole: ObservationRecord[] = [];
  const partial: ObservationRecord[] = [];

  for (const observation of observations) {
    if (observation.regions.length === 0) continue;

    const hits = observation.regions.filter(
      (region) => region.fingerprint !== undefined && shapes.has(region.fingerprint),
    );
    if (hits.length === 0) continue;

    // A capped list is not a complete one. Regions the run found and chose not
    // to record could be anything, so a subject whose evidence was truncated
    // cannot support "this shape is the entire change" however its recorded
    // regions look.
    const capped = observation.truncated !== undefined && observation.truncated.regions > 0;

    if (!capped && hits.length === observation.regions.length) whole.push(observation);
    else partial.push(observation);
  }

  return { whole, partial };
}

function find(report: CliRunReport, subject: string): ObservationRecord {
  const found = report.observations.find((entry) => entry.subject === subject);
  if (found !== undefined) return found;

  const skipped = (report.notObserved ?? []).find((entry) => entry.subject === subject);
  if (skipped !== undefined) {
    throw new OperatorError(
      `\`${subject}\` was not observed by this run (${skipped.because}), so there is no ` +
        'change to accept',
    );
  }

  throw new OperatorError(
    `this run has no subject \`${subject}\`; it has: ` +
      report.observations.map((entry) => entry.subject).join(', '),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
