import type {
  AccessibilitySnapshot,
  Digest,
  Rect,
  SubjectRef,
} from '@variance-authority/core';

export type PresentationFindingRule =
  | 'SEPARATION_COLLISION'
  | 'SPACING_RELATION_COLLISION'
  | 'ALIGNMENT_OUTLIER'
  | 'BASELINE_DRIFT'
  | 'PROMINENCE_COLLAPSE'
  | 'SURFACE_COLLISION'
  | 'REPETITION_GRAMMAR_COLLAPSE'
  | 'PRESENTATION_GRAMMAR_DRIFT';

export type PresentationRelationKind =
  | 'contains'
  | 'separates'
  | 'aligns'
  | 'shares-baseline'
  | 'semantic-peer';

export interface ElementReference {
  /** Zero is the subject root; later roots are portal content in capture order. */
  readonly root: number;
  /** Child-node indices from that root. Text nodes occupy an index but are not graph nodes. */
  readonly path: string;
}

export interface TypographyEvidence {
  readonly family?: string;
  readonly sizePx?: number;
  readonly weight?: number;
  readonly style?: string;
  readonly lineHeightPx?: number;
  readonly foreground?: string;
}

export interface SurfaceEvidence {
  readonly fill?: string;
  readonly containingFill?: string;
  readonly perceptualDifference?: number;
  readonly borderWidthPx: number;
  readonly shadow: boolean;
}

export interface ProminenceEvidence {
  /** Relative visual magnitude, not a quality or severity score. */
  readonly magnitude: number;
  readonly cluster?: string;
}

export interface PresentationNode {
  readonly id: string;
  readonly ref: ElementReference;
  readonly parent?: string;
  readonly children: readonly string[];
  readonly tag: string;
  readonly semanticClass: string;
  readonly role?: string;
  readonly name?: string;
  readonly text?: string;
  readonly state: Readonly<Record<string, string | boolean | number>>;
  readonly stateSignature: string;
  readonly rect: Rect;
  readonly typography: TypographyEvidence;
  readonly surface: SurfaceEvidence;
  readonly prominence: ProminenceEvidence;
}

export interface PresentationRelation {
  readonly id: string;
  readonly kind: PresentationRelationKind;
  readonly from: string;
  readonly to: string;
  readonly axis?: 'horizontal' | 'vertical' | 'overlap';
  readonly distancePx?: number;
  readonly spacingCluster?: string;
  readonly boundaryStrength?: number;
  readonly alignment?: 'left' | 'right' | 'horizontal-center' | 'top' | 'bottom' | 'vertical-center';
}

export interface SpacingCluster {
  readonly id: string;
  readonly centerPx: number;
  readonly minPx: number;
  readonly maxPx: number;
  readonly samples: number;
}

export interface AlignmentAxis {
  readonly id: string;
  readonly kind: NonNullable<PresentationRelation['alignment']>;
  readonly coordinate: number;
  readonly members: readonly string[];
}

export type PresentationAlignmentKind = AlignmentAxis['kind'];

export interface PresentationAlignmentReading {
  readonly formatVersion: 1;
  readonly report: Digest;
  /** The box or composition in which the caller says these nodes form one visual flow. */
  readonly owner: PresentationNode;
  readonly kind: PresentationAlignmentKind;
  readonly coordinatePx: number;
  readonly spreadPx: number;
  readonly members: readonly {
    readonly node: PresentationNode;
    readonly coordinatePx: number;
    readonly deviationPx: number;
  }[];
  /** Axis and member marks derived from this reading; painting does not acquire the page. */
  readonly paint: readonly PaintInstruction[];
}

export interface BaselineCluster {
  readonly id: string;
  readonly coordinate: number;
  readonly confidence: 'inferred';
  readonly members: readonly { readonly node: string; readonly deviationPx: number }[];
}

export interface ProminenceCluster {
  readonly id: string;
  readonly magnitude: number;
  readonly members: readonly string[];
  readonly semanticClasses: readonly string[];
}

export interface SurfaceGroup {
  readonly id: string;
  readonly fill: string;
  readonly members: readonly string[];
}

export interface PresentationSignature {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly leftPx: number;
  readonly internalGapPx?: number;
  readonly boundaryStrength?: number;
  readonly prominenceCluster?: string;
  readonly surfaceGroup?: string;
}

export interface RepeatedPattern {
  readonly id: string;
  readonly parent: string;
  readonly semanticShape: string;
  readonly instances: readonly string[];
  readonly recurringLabels: readonly string[];
  readonly presentationSimilarity: number;
  readonly dominant: PresentationSignature;
  readonly dominantInstances: readonly string[];
  readonly outliers: readonly {
    readonly node: string;
    readonly deviation: number;
    readonly explainedByState: boolean;
  }[];
}

export interface PresentationFinding {
  /** Stable within one deterministic report. */
  readonly id: string;
  readonly rule: PresentationFindingRule;
  /** The graph node whose immediate structural relationship produced this finding. */
  readonly owner: string;
  readonly nodes: readonly string[];
  readonly pattern?: string;
  readonly measurements: Readonly<Record<string, number | string>>;
}

export interface PresentationTelemetry {
  readonly content: {
    readonly elements: number;
    readonly characters: number;
    readonly estimatedLines: number;
    readonly controls: number;
    readonly repeatedObjects: number;
  };
  readonly dimensions?: {
    readonly regionWidthPx: number;
    readonly regionHeightPx: number;
    readonly viewportWidthPx: number;
    readonly viewportHeightPx: number;
    readonly viewportHeights: number;
  };
  readonly utilization?: {
    readonly horizontal: number;
    readonly occupiedArea: number;
  };
  readonly density?: {
    readonly charactersPer1000Px2: number;
    readonly linesPerViewport: number;
    readonly controlsPerViewport: number;
    readonly repeatedObjectsPerViewport: number;
  };
}

export type PaintLayer =
  | 'semantic'
  | 'spacing'
  | 'axes'
  | 'baselines'
  | 'surfaces'
  | 'prominence'
  | 'repetition'
  | 'findings';

export interface PaintInstruction {
  readonly id: string;
  /** The graph node that owns the painted relationship. */
  readonly owner: string;
  /** Graph nodes touched by this measurement. */
  readonly nodes: readonly string[];
  readonly finding?: string;
  readonly pattern?: string;
  readonly layer: PaintLayer;
  readonly shape: 'rect' | 'line' | 'label';
  readonly color: string;
  readonly label: string;
  readonly rect?: Rect;
  readonly line?: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
}

export type PresentationFocusDepth = 'owner' | 'subtree';

export interface PresentationFocus {
  readonly formatVersion: 1;
  readonly report: Digest;
  readonly depth: PresentationFocusDepth;
  readonly owner: PresentationNode;
  /** Owner, immediate children, and owned evidence nodes; or the complete subtree at `subtree` depth. */
  readonly nodes: readonly PresentationNode[];
  readonly patterns: readonly RepeatedPattern[];
  readonly findings: readonly PresentationFinding[];
  readonly paint: readonly PaintInstruction[];
  /** Evidence below an owner focus, kept separate rather than folded into its findings. */
  readonly nested: {
    readonly owners: number;
    readonly patterns: number;
    readonly findings: number;
  };
}

export interface PresentationReport {
  readonly formatVersion: 1;
  readonly digest: Digest;
  /** Presentation-independent structure, text, DOM-correlated semantics, and state. */
  readonly contentDigest: Digest;
  readonly subject: SubjectRef;
  readonly semantic: {
    /** An empty array means semantic anchoring ran and found no anchors. */
    readonly anchors: readonly string[];
    /** Absence means browser ARIA was not observed; empty or partial roots remain present. */
    readonly browserAccessibility?: AccessibilitySnapshot;
  };
  readonly telemetry: PresentationTelemetry;
  readonly graph: {
    readonly nodes: readonly PresentationNode[];
    readonly relations: readonly PresentationRelation[];
  };
  readonly spacing?: readonly SpacingCluster[];
  readonly axes?: readonly AlignmentAxis[];
  readonly baselines?: readonly BaselineCluster[];
  readonly prominence?: readonly ProminenceCluster[];
  readonly surfaces?: readonly SurfaceGroup[];
  readonly patterns?: readonly RepeatedPattern[];
  /** Absence means the capture had no layout evidence; empty means it was measured and clean. */
  readonly findings?: readonly PresentationFinding[];
  readonly paint?: readonly PaintInstruction[];
}

export interface PresentationComparison {
  readonly formatVersion: 1;
  readonly before: Digest;
  readonly after: Digest;
  readonly findings?: readonly {
    readonly rule: PresentationFindingRule;
    readonly before: number;
    readonly after: number;
    readonly delta: number;
  }[];
  readonly information: {
    readonly content: {
      readonly before: Digest;
      readonly after: Digest;
      readonly preserved: boolean;
    };
    readonly characters: { readonly before: number; readonly after: number };
    readonly elements: { readonly before: number; readonly after: number };
    readonly repeatedObjects: { readonly before: number; readonly after: number };
  };
}
