import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AccessibilitySnapshot } from '@variance-authority/core';
import type { ReviewConfig } from '../config.js';
import { OperatorError } from '../exit.js';
import { messageOf } from '../config-values.js';
import type { CliRunReport } from './run-report.js';

/**
 * The caller the tribunal's write half never had.
 *
 * Rung 4 of [`flows.md`](../../../../docs/flows.md) is a review surface: builds,
 * a docket, region overlays, decisions that are recorded. Every part of it
 * shipped except the one that puts a build in front of a reviewer. Nothing in
 * this package and nothing in the shipped action posted to the ingest route, so
 * an adopter who stood up a deployment, minted the two tokens and opened the
 * page still had to write the upload themselves — against a body shape they
 * could only learn by reading the Worker's test suite. A rung whose write half
 * has no caller is a rung nobody is standing on.
 *
 * ## Separate from `run`, and that is the design
 *
 * The obvious alternative is to post at the end of a run. It is worse in three
 * ways that all point the same direction.
 *
 * A sharded suite produces N reports and **one** build; a run that posted its
 * own would file six builds for one commit and give the reviewer six dockets
 * over six sixths of the subjects. `variance push` takes the same report
 * arguments `report` and `comment` take, so the merge that already exists is the
 * merge that happens.
 *
 * A run that fails to reach the service must not turn a correct observation red.
 * Keeping the upload a separate command keeps the two exit codes apart: the run
 * says what it saw, and this says whether the service heard it. And a build that
 * failed to post can be posted again from the artifact, on a machine that never
 * ran a browser, because everything this needs is on disk.
 *
 * ## What it will not send
 *
 * **The review token, ever.** {@link ReviewConfig} takes the ingest one, and a
 * deployment refuses two equal tokens at construction. Approving promotes a
 * baseline every later run is compared against; a value that could do that has
 * no business in a config a run reads.
 *
 * **A candidate with no sidecar.** The `after` image is the only one that can be
 * promoted, and promoting it writes a baseline keyed on its document digest. The
 * digest is in the sidecar the run wrote beside the PNG, so a candidate whose
 * sidecar cannot be read is sent as *no* candidate rather than as bytes with an
 * invented key — `approvable` on the far side would otherwise say yes about an
 * approval that could never settle a later run. The subject still goes up, with
 * its verdict, its regions and its `before`; what it loses is the button.
 */

export interface PushOptions {
  readonly report: CliRunReport;
  /** Where `ObservationRecord.images` paths are relative to. */
  readonly reportDir: string;
  readonly review: ReviewConfig;
  /** The operator's own id for the run — a CI job number, a workflow run id. */
  readonly build: string;
  readonly commit: string;
  readonly branch?: string;
  /** Injected so a test can push a report whose images are not on any disk. */
  readonly deps?: PushDeps;
}

export interface PushDeps {
  readonly read?: (path: string) => Promise<Buffer>;
  readonly fetch?: typeof globalThis.fetch;
}

export interface PushResult {
  readonly build: string;
  readonly endpoint: string;
  readonly subjects: number;
  /** How many of each kind of image went with it. */
  readonly images: { readonly after: number; readonly before: number; readonly diff: number };
  /** Encoded size of the body, which is what the deployment has to accept. */
  readonly bytes: number;
  /** Images the report named and this could not send, with the reason. */
  readonly withheld: readonly Withheld[];
}

export interface Withheld {
  readonly subject: string;
  readonly kind: 'after' | 'before' | 'diff';
  readonly because: string;
}

/** The sidecar a run writes beside every candidate, as much of it as this needs. */
interface Sidecar {
  readonly documentDigest?: string;
  readonly width?: number;
  readonly height?: number;
  readonly missingFonts?: readonly string[];
  readonly accessibility?: AccessibilitySnapshot;
}

export async function push(options: PushOptions): Promise<PushResult> {
  const read = options.deps?.read ?? ((path: string) => readFile(path));
  const send = options.deps?.fetch ?? globalThis.fetch;
  const withheld: Withheld[] = [];
  const images: Record<string, Record<string, unknown>> = {};
  const counted = { after: 0, before: 0, diff: 0 };

  for (const observation of options.report.observations) {
    const named = observation.images;
    if (named === undefined) continue;

    const subject = observation.subject;
    const entry: Record<string, unknown> = {};

    for (const kind of ['before', 'diff'] as const) {
      const path = named[kind];
      if (path === undefined) continue;
      const bytes = await bytesOf(read, resolve(options.reportDir, path));
      if (!bytes.ok) {
        withheld.push({ subject, kind, because: bytes.because });
        continue;
      }
      entry[kind] = { bytes: bytes.value };
      counted[kind] += 1;
    }

    if (named.after !== undefined) {
      const after = await candidate(read, resolve(options.reportDir, named.after));
      if (!after.ok) withheld.push({ subject, kind: 'after', because: after.because });
      else {
        entry['after'] = after.value;
        counted.after += 1;
      }
    }

    if (Object.keys(entry).length > 0) images[subject] = entry;
  }

  const body = JSON.stringify({
    build: options.build,
    commit: options.commit,
    ...(options.branch !== undefined ? { branch: options.branch } : {}),
    report: options.report,
    ...(Object.keys(images).length > 0 ? { images } : {}),
  });

  const endpoint = `${options.review.endpoint.replace(/\/$/, '')}/review/builds`;
  let response: Response;
  try {
    response = await send(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.review.token}`,
      },
      body,
    });
  } catch (error) {
    // Never a verdict. The run already happened and its report is on disk, so
    // the operator's next move is to fix the address or the network and push the
    // same artifact again — which the message says, because otherwise the
    // reasonable next move looks like re-running the suite.
    throw new OperatorError(
      `could not reach the review surface at ${endpoint}: ${messageOf(error)}. ` +
        'The report is unaffected; `variance push` may be run again against it.',
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new OperatorError(
      `the review surface refused this build: ${response.status} ${response.statusText}. ` +
        `${(await response.text().catch(() => '')).slice(0, 400)}`.trim(),
    );
  }

  return {
    build: options.build,
    endpoint,
    subjects: options.report.observations.length,
    images: counted,
    bytes: Buffer.byteLength(body, 'utf8'),
    withheld,
  };
}

/** Something to send, or the sentence saying why it is not going. */
type Sent<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly because: string };

/** Base64 of one image, or why it is not going. */
async function bytesOf(read: (path: string) => Promise<Buffer>, path: string): Promise<Sent<string>> {
  try {
    return { ok: true, value: (await read(path)).toString('base64') };
  } catch (error) {
    return { ok: false, because: `${path} could not be read: ${messageOf(error)}` };
  }
}

/**
 * The candidate and the sidecar that makes it approvable, or neither.
 *
 * Both or nothing, for the reason on the module: bytes under an invented digest
 * are an approval that can never settle a later run, arriving at a surface whose
 * whole job is to promote them.
 */
async function candidate(
  read: (path: string) => Promise<Buffer>,
  path: string,
): Promise<Sent<Record<string, unknown>>> {
  const sidecarPath = `${path.replace(/\.png$/, '')}.json`;

  let sidecar: Sidecar;
  try {
    sidecar = JSON.parse((await read(sidecarPath)).toString('utf8')) as Sidecar;
  } catch (error) {
    return { ok: false, because: `${sidecarPath} could not be read: ${messageOf(error)}` };
  }

  if (
    sidecar.documentDigest === undefined ||
    typeof sidecar.width !== 'number' ||
    typeof sidecar.height !== 'number'
  ) {
    return {
      ok: false,
      because:
        `${sidecarPath} carries no \`documentDigest\`, \`width\` and \`height\`, so this ` +
        'candidate could be looked at but never approved',
    };
  }

  const bytes = await bytesOf(read, path);
  if (!bytes.ok) return bytes;

  return {
    ok: true,
    value: {
      bytes: bytes.value,
      documentDigest: sidecar.documentDigest,
      width: sidecar.width,
      height: sidecar.height,
      missingFonts: sidecar.missingFonts ?? [],
      ...(sidecar.accessibility !== undefined ? { accessibility: sidecar.accessibility } : {}),
    },
  };
}

/** What went up, as the operator reads it. */
export function formatPush(result: PushResult): string {
  const lines = [
    `pushed build ${result.build} to ${result.endpoint}`,
    `  ${result.subjects} subject(s), ` +
      `${result.images.after} candidate(s), ${result.images.before} baseline(s), ` +
      `${result.images.diff} diff(s) — ${Math.round(result.bytes / 1024)} KiB`,
    // Named one by one rather than counted. A withheld candidate is a subject a
    // reviewer can look at and cannot decide, and discovering that on the page —
    // where the only symptom is a missing button — is discovering it too late.
    ...result.withheld.map(
      (entry) => `  [withheld] ${entry.subject} ${entry.kind}: ${entry.because}`,
    ),
  ];
  return lines.join('\n');
}
