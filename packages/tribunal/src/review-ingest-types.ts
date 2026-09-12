import type { AccessibilitySnapshot, ComponentHash, RenderIdentity } from '@variance-authority/core/format';
import type { RunReport } from '@variance-authority/report';

/**
 * What a push sends, as opposed to what a reviewer is shown.
 *
 * Apart from [`review-types.ts`](./review-types.ts) because the two vocabularies
 * face opposite directions and only one of them is a wire contract a CLI on
 * somebody else's machine has to keep agreeing with. Widening a field here is a
 * change to what an older `variance push` may send; widening one there is a
 * change to what this deployment's own surface renders.
 *
 * The arguments that produced these shapes are on the shapes, because that is
 * where somebody about to change one will look.
 */

/**
 * One image the run kept, as it arrives — the bytes, or a claim on bytes here.
 *
 * Exactly one of the two is present, and which one is the whole of the upload
 * saving. Objects are addressed by their SHA-256, so a run can compute a key
 * without asking, and `POST /review/have` answers which of those keys this
 * deployment can already produce the bytes for. On an unchanged suite that is
 * nearly all of them: every `before` is a baseline this service handed the run
 * itself, and every `after` of a settled subject is the object that baseline
 * already is.
 *
 * Not modelled as a union, because `after` intersects this with its sidecar
 * fields and a union under an intersection makes every read of `width` a
 * discrimination. The refusal is in `store`, where the build and the subject are
 * in hand and the message can name them.
 */
export interface CandidateImage {
  /** Base64 PNG — the same encoding a `Raster` carries, for the same reason. */
  readonly bytes?: string;
  /**
   * Hex SHA-256 of the PNG, for bytes `POST /review/have` said were already here.
   *
   * Refused on ingest if the object is gone — swept between the question and the
   * build — rather than recorded as a subject with an image nobody can render.
   */
  readonly digest?: string;
}

/**
 * What a run produced for one subject, over and above the report's record of it.
 *
 * `after` is the candidate and is the only one that can be promoted, which is why
 * it alone carries the sidecar fields. `before` and `diff` exist to be looked at.
 */
export interface SubjectImages {
  readonly after?: CandidateImage & {
    readonly documentDigest: string;
    /**
     * The identity the document was painted under, when the push carried it.
     *
     * Not the build's. A renderer that paints 1x and 2x viewports in one run
     * reports one machine identity with `deviceScaleFactor` at 1, and every
     * baseline lookup keys on the per-document identity instead — so promoting
     * under the build's files a retina baseline under a digest no run asks for.
     *
     * Optional because a build pushed by an older CLI does not carry it, and
     * promotion falls back to the build's identity there: right at 1x, and what
     * this service already did.
     */
    readonly identity?: RenderIdentity;
    readonly width: number;
    readonly height: number;
    readonly missingFonts: readonly string[];
    readonly accessibility?: AccessibilitySnapshot;
    /**
     * What the document said about its own components, and what inspection found
     * in it. Carried so a promotion produces the same baseline the local durable
     * store would have: without the hashes a later run ranks causes by area, and
     * without the marks it reports every standing defect as newly arrived.
     */
    readonly components?: readonly ComponentHash[];
    readonly findingMarks?: readonly string[];
  };
  /**
   * The baseline this run compared against, with its own dimensions when they
   * could be read.
   *
   * Optional, and absent means *not measured* — never *the same size as the
   * candidate*. That assumption is the thing this field exists to stop: a
   * baseline drawn to the candidate's box is a width change resampled out of
   * existence, on the one screen where somebody decides whether it is allowed.
   */
  readonly before?: CandidateImage & {
    readonly width?: number;
    readonly height?: number;
  };
  readonly diff?: CandidateImage;
}

export interface BuildIngest {
  /** The operator's own id for the run — a CI job number, a workflow run id. */
  readonly build: string;
  readonly commit: string;
  readonly branch?: string;
  readonly report: RunReport;
  /** Keyed by subject. A subject with no entry is recorded with no images. */
  readonly images?: Readonly<Record<string, SubjectImages>>;
}
