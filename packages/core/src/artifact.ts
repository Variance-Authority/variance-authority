import type { SourceIndex } from './attribute/source.js';
import type {
  AccessibilitySnapshot,
  CapturedValue,
  Raster,
  RenderDocument,
  SemanticSnapshot,
  SubjectRef,
} from './format/index.js';

/**
 * Material already captured from a host, before retention or reporting.
 *
 * Three arms, and the third is the one that is not a rendering at all: a value
 * has no viewport, no placement and nothing to paint, and it reaches the same
 * attribution path as the other two (ADR-0044). Every existing reader narrows
 * with `=== 'document'`, so a value arm is not a compile error anywhere — which
 * means each of those readers owes an explicit refusal rather than a silent drop.
 */
export type CaptureMaterial =
  | { readonly kind: 'document'; readonly document: RenderDocument }
  | { readonly kind: 'raster'; readonly raster: Raster }
  | { readonly kind: 'value'; readonly value: CapturedValue };

/**
 * The acquisition boundary shared by host adapters.
 *
 * The material decides whether a renderer is needed. Semantic and source
 * evidence stay beside it so an in-place raster and a deferred document reach
 * the same attribution path without inventing host-specific result types.
 */
export interface CaptureArtifact {
  readonly artifactVersion: 1;
  readonly subject: SubjectRef;
  readonly material: CaptureMaterial;
  readonly snapshot?: SemanticSnapshot;
  /** Browser-native accessibility evidence from the same stabilized mount. */
  readonly accessibility?: AccessibilitySnapshot;
  readonly source?: SourceIndex;
  readonly stabilization?: readonly string[];
  readonly attempt?: {
    readonly retry: number;
    readonly repeat: number;
    readonly shard?: { readonly index: number; readonly total: number };
  };
}
