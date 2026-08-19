import type { SourceIndex } from './attribute/source.js';
import type {
  Raster,
  RenderDocument,
  SemanticSnapshot,
  SubjectRef,
} from './format/index.js';

/** Material already captured from a host, before retention or reporting. */
export type CaptureMaterial =
  | { readonly kind: 'document'; readonly document: RenderDocument }
  | { readonly kind: 'raster'; readonly raster: Raster };

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
  readonly source?: SourceIndex;
  readonly stabilization?: readonly string[];
  readonly attempt?: {
    readonly retry: number;
    readonly repeat: number;
    readonly shard?: { readonly index: number; readonly total: number };
  };
}
