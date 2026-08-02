import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Raster } from '@variance-authority/core';
import type { RasterStore } from '@variance-authority/raster';
import type { ObservationRecord } from '@variance-authority/mcp';
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
 * ## What this deliberately does not do
 *
 * It does not write to the history store. A history row carries per-component
 * band hashes (spec 0002), and a run report carries pixels and regions — the
 * hashes are not in it and cannot be derived from it. Recording an `accepted: true`
 * row with fabricated hashes would corrupt every later drift question, so the
 * acceptance of a *semantic* change stays with the tier that has the hashes.
 */

export interface AcceptOptions {
  readonly report: CliRunReport;
  /** Directory the report's relative image paths resolve against. */
  readonly reportDir: string;
  readonly store: RasterStore;
  /** Subject ids named on the command line. Ignored when {@link all} is set. */
  readonly subjects: readonly string[];
  readonly all: boolean;
  /** Reads a candidate image and its sidecar. Injected so this is testable on no disk. */
  readonly read: CandidateReader;
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
}

export async function accept(options: AcceptOptions): Promise<AcceptResult> {
  const { report } = options;
  const accepted: Accepted[] = [];
  const refused: Refused[] = [];
  let alreadyBaseline = 0;

  if (!options.all && options.subjects.length === 0) {
    throw new OperatorError(
      'name at least one subject, or pass --all. Accepting nothing is not the same as ' +
        'accepting everything, and this command will not guess which was meant.',
    );
  }

  const targets = options.all
    ? report.observations
    : options.subjects.map((subject) => find(report, subject));

  for (const observation of targets) {
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

  return { accepted, refused, alreadyBaseline };
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
  ];
  return lines.join('\n');
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
