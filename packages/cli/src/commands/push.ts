import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  AccessibilitySnapshot,
  ComponentHash,
  RenderIdentity,
} from '@variance-authority/core/format';
import { pngSize } from '@variance-authority/png';
import type { ReviewConfig } from '../config.js';
import { OperatorError } from '../exit.js';
import { messageOf } from '../config-values.js';
import type { CliRunReport } from './run-report.js';
import { alreadyHeld, endpointOf } from './push-have.js';
import { type Reached, reach, versionNote } from '../version.js';

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
 * ## What it asks before it sends anything
 *
 * One `POST /review/have` with the digest of every image it is holding. The
 * deployment stores objects under their content, so an image it can already
 * produce does not need to travel — and on a suite that did not change that is
 * nearly all of them: every `before` *is* the baseline that deployment handed
 * this run, and an unchanged subject's `after` is a second copy of the same
 * picture. What goes up for those is a sixty-four character string.
 *
 * The question is best-effort in both directions. A deployment that does not
 * answer it gets the push this command made before the route existed, and a
 * deployment that swept an object between the answer and the build refuses that
 * build by name — which is recoverable, because the run's images are still on
 * disk and `variance push` may be run again.
 *
 * ## What it will not send
 *
 * **The difference mask.** It is the one image content addressing can do nothing
 * for: a mask is new bytes by definition whenever anything moved, so it never
 * matches a digest the deployment already holds and never will. The run still
 * writes one — the local report is read without a service and that is the
 * picture in it — but the review surface holds both captures and computes the
 * mask from them, with the same function, at the same policy, when a reviewer
 * asks to see it. Builds pushed by earlier versions kept theirs and are still
 * served it.
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
  /**
   * Told where this is, while it is still there.
   *
   * A push of a real suite spends most of its wall clock before the request
   * exists: every image the report named is read off disk and base64-encoded
   * into one body, and a few hundred subjects of that is tens of seconds during
   * which the command has printed nothing. Silence there is indistinguishable
   * from a hang against an address that is not answering, and the operator's
   * response to the two is opposite — wait, or interrupt and check the endpoint.
   *
   * So the phase is reported rather than inferred. Optional because nothing in
   * this function's result depends on it: a caller that wants the bytes and not
   * the narration leaves it out, and the events stop being computed.
   */
  readonly onProgress?: (event: PushProgress) => void;
  /** Injected so a test can push a report whose images are not on any disk. */
  readonly deps?: PushDeps;
}

/**
 * Where a push has got to, in the two phases it actually has.
 *
 * `encoding` is measurable and reported per subject. `sending` is one POST of
 * the whole body, so it has no progress at all — what it has is a size, which is
 * the number that explains how long the silence after it is going to be. Naming
 * the phases separately is the point: a push stuck at `sending` is a network
 * question, and one stuck at `encoding` is a disk.
 */
export type PushProgress =
  | {
      readonly phase: 'encoding';
      /** The subject just encoded, absent on the event that opens the phase. */
      readonly subject?: string;
      readonly done: number;
      readonly total: number;
      /** Image bytes read off disk so far — the upper bound on what can be sent. */
      readonly bytes: number;
    }
  | {
      /**
       * What the far end said it was — first, because it explains the rest.
       *
       * Emitted whether or not there is anything wrong with the answer. A push
       * that names both versions on the way past is a push whose log, six weeks
       * later, still says which halves were talking.
       */
      readonly phase: 'service';
      readonly note?: string;
    }
  | {
      /** The one question: of these images, which does the deployment already hold. */
      readonly phase: 'asking';
      readonly digests: number;
    }
  | { readonly phase: 'sending'; readonly bytes: number };

export interface PushDeps {
  readonly read?: (path: string) => Promise<Buffer>;
  readonly fetch?: typeof globalThis.fetch;
  /** Injected so a test can assert a duration rather than observe one. */
  readonly now?: () => number;
}

export interface PushResult {
  readonly build: string;
  readonly endpoint: string;
  /**
   * Wall clock of the whole push, in milliseconds.
   *
   * On the report because the number an operator needs is the one they can
   * compare: a push of this suite took forty seconds yesterday and four minutes
   * today, and the second is a fact about the endpoint or the disk that no
   * count of subjects will tell them. A tick that scrolled past is not a
   * measurement — it has to land in the line they keep.
   */
  readonly elapsedMs: number;
  /**
   * What the deployment said about itself, and what this CLI is.
   *
   * On the result rather than only on the tick, because the mismatch outlives
   * the push: an operator reading a CI log a month later is asking why that
   * build uploaded everything, and the answer has to be in the line they kept.
   */
  readonly service: Reached;
  readonly subjects: number;
  /** How many of each kind of image the build names — sent or named by digest. */
  readonly images: { readonly after: number; readonly before: number };
  /**
   * Of those, how many went as a digest because this deployment already held them.
   *
   * Reported because it is the number that explains the wall clock. A suite that
   * did not change reuses nearly everything and pushes a body of report text; the
   * same suite after a font change reuses nothing and pushes every pixel. An
   * operator watching one push take forty times as long as yesterday's is owed
   * the reason, and the reason is this count collapsing.
   */
  readonly reused: number;
  /** Encoded size of the body, which is what the deployment has to accept. */
  readonly bytes: number;
  /** Images the report named and this could not send, with the reason. */
  readonly withheld: readonly Withheld[];
}

export interface Withheld {
  readonly subject: string;
  readonly kind: 'after' | 'before';
  readonly because: string;
}

/** The sidecar a run writes beside every candidate, as much of it as this needs. */
interface Sidecar {
  readonly documentDigest?: string;
  /**
   * The identity the *document* was painted under, and not the run's.
   *
   * `report.identity` describes the machine, and a renderer that serves 1x and
   * 2x viewports in one run leaves `deviceScaleFactor` at 1 there — the
   * Playwright renderer says so in its own source, and says nothing may key a
   * store on it. What every lookup keys on is `identityFor`, which folds in the
   * document's scale, and that is the value the run wrote here. A promotion
   * given only the machine identity files a retina baseline under a digest no
   * run asks for, which is a subject that stays `new` while the page reports the
   * approval as recorded.
   */
  readonly identity?: RenderIdentity;
  readonly width?: number;
  readonly height?: number;
  readonly missingFonts?: readonly string[];
  readonly accessibility?: AccessibilitySnapshot;
  readonly components?: readonly ComponentHash[];
  readonly findingMarks?: readonly string[];
}

export async function push(options: PushOptions): Promise<PushResult> {
  const read = options.deps?.read ?? ((path: string) => readFile(path));
  const send = options.deps?.fetch ?? globalThis.fetch;
  const now = options.deps?.now ?? ((): number => Date.now());
  const started = now();
  const withheld: Withheld[] = [];
  // Before the disk read, not after it. The answer changes nothing this function
  // does — it is the same body either way — but it is the sentence that explains
  // the next forty seconds, and a sentence printed after the wait it describes
  // is a sentence nobody needed.
  const service = await reach(send, endpointOf(options.review), options.review.token());
  const note = versionNote(service);
  options.onProgress?.({ phase: 'service', ...(note !== undefined ? { note } : {}) });
  const images: Record<string, Record<string, unknown>> = {};
  const counted = { after: 0, before: 0 };

  // Counted over the observations that name images rather than over all of them,
  // because the subjects with nothing to send pass through this loop for free
  // and a denominator that included them would stall visibly at the end.
  const tell = options.onProgress;
  const total = options.report.observations.filter((one) => one.images !== undefined).length;
  let encoded = 0;
  let done = 0;
  tell?.({ phase: 'encoding', done, total, bytes: 0 });

  const pending: Pending[] = [];

  for (const observation of options.report.observations) {
    const named = observation.images;
    if (named === undefined) continue;

    const subject = observation.subject;

    for (const kind of ['before'] as const) {
      const path = named[kind];
      if (path === undefined) continue;
      const bytes = await bytesOf(read, resolve(options.reportDir, path));
      if (!bytes.ok) {
        withheld.push({ subject, kind, because: bytes.because });
        continue;
      }
      // The baseline's dimensions, read from its own header rather than assumed
      // from the candidate's. A capture that changed width *is* the change, and
      // a viewer handed one size for both layers draws them to the same box and
      // resamples that change away — at exactly the moment it is largest. Read
      // here rather than server-side because the bytes are already in hand;
      // absent when the header does not read, which is not a size of zero.
      //
      // Sent with the digest as well as with the bytes: it describes the
      // *reference to* the image, and a subject whose baseline is already in the
      // bucket still needs its viewer told how big it is.
      const size = pngSize(bytes.value);
      pending.push({ subject, kind, bytes: bytes.value, digest: digestOf(bytes.value), rest: { ...size } });
      encoded += bytes.value.byteLength;
      counted[kind] += 1;
    }

    if (named.after !== undefined) {
      const after = await candidate(read, resolve(options.reportDir, named.after));
      if (!after.ok) withheld.push({ subject, kind: 'after', because: after.because });
      else {
        pending.push({
          subject,
          kind: 'after',
          bytes: after.value.bytes,
          digest: digestOf(after.value.bytes),
          rest: after.value.sidecar,
        });
        encoded += after.value.bytes.byteLength;
        counted.after += 1;
      }
    }

    done += 1;
    tell?.({ phase: 'encoding', subject, done, total, bytes: encoded });
  }

  const digests = [...new Set(pending.map((one) => one.digest))];
  tell?.({ phase: 'asking', digests: digests.length });
  const held = await alreadyHeld(send, options.review, digests);

  let reused = 0;
  for (const one of pending) {
    const entry = (images[one.subject] ??= {});
    if (held.has(one.digest)) {
      entry[one.kind] = { digest: one.digest, ...one.rest };
      reused += 1;
    } else {
      entry[one.kind] = { bytes: one.bytes.toString('base64'), ...one.rest };
    }
  }

  const body = JSON.stringify({
    build: options.build,
    commit: options.commit,
    ...(options.branch !== undefined ? { branch: options.branch } : {}),
    report: options.report,
    ...(Object.keys(images).length > 0 ? { images } : {}),
  });

  const endpoint = `${endpointOf(options.review)}/review/builds`;
  tell?.({ phase: 'sending', bytes: Buffer.byteLength(body, 'utf8') });

  let response: Response;
  try {
    response = await send(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.review.token()}`,
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
    elapsedMs: now() - started,
    service,
    subjects: options.report.observations.length,
    images: counted,
    reused,
    bytes: Buffer.byteLength(body, 'utf8'),
    withheld,
  };
}

/** One image read off disk, with everything the body says about it but the bytes. */
interface Pending {
  readonly subject: string;
  readonly kind: 'after' | 'before' | 'diff';
  readonly bytes: Buffer;
  readonly digest: string;
  /** The size for a `before`, the sidecar for an `after` — sent either way. */
  readonly rest: Record<string, unknown>;
}

/** The key the deployment would store these bytes under, computed the same way. */
function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Something to send, or the sentence saying why it is not going. */
type Sent<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly because: string };

/** Base64 of one image, or why it is not going. */
async function bytesOf(read: (path: string) => Promise<Buffer>, path: string): Promise<Sent<Buffer>> {
  try {
    return { ok: true, value: await read(path) };
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
): Promise<Sent<{ readonly bytes: Buffer; readonly sidecar: Record<string, unknown> }>> {
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
    typeof sidecar.height !== 'number' ||
    !Array.isArray(sidecar.missingFonts)
  ) {
    return {
      ok: false,
      because:
        `${sidecarPath} carries no \`documentDigest\`, \`width\`, \`height\` and ` +
        '`missingFonts`, so this candidate could be looked at but never approved',
    };
  }

  const bytes = await bytesOf(read, path);
  if (!bytes.ok) return bytes;

  return {
    ok: true,
    value: {
      bytes: bytes.value,
      sidecar: {
        documentDigest: sidecar.documentDigest,
        // Forwarded, not summarised. Every one of these was written by the run
        // beside the PNG, survives the local durable store, and is read by a
        // later run off whatever baseline this candidate becomes — so a
        // transport that drops one makes the review surface the lossy way to
        // approve an image.
        ...(sidecar.identity !== undefined ? { identity: sidecar.identity } : {}),
        width: sidecar.width,
        height: sidecar.height,
        missingFonts: sidecar.missingFonts,
        ...(sidecar.accessibility !== undefined ? { accessibility: sidecar.accessibility } : {}),
        ...(sidecar.components !== undefined ? { components: sidecar.components } : {}),
        ...(sidecar.findingMarks !== undefined ? { findingMarks: sidecar.findingMarks } : {}),
      },
    },
  };
}

/**
 * Re-exported so a caller that pushes and then prints has one import.
 *
 * The seam is real — [`push-progress.ts`](./push-progress.ts) changes when
 * somebody watching says they were not told enough, and this file changes when
 * the body does — but it is a seam for whoever edits, not for whoever calls.
 */
export { pushTicker, formatPush, type TickerClock } from './push-progress.js';
