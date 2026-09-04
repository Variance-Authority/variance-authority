// compass: variance-authority.presentation

export { analyzePresentation } from './analyze.js';
export type { AnalyzePresentationOptions } from './analyze.js';
export { inspectPresentationAlignment } from './alignment.js';
export { inspectPresentationSpacing } from './spacing.js';
export { inspectPresentationHierarchy } from './hierarchy.js';
export { presentationSignal } from './report.js';
export type { PresentationSignalOptions } from './report.js';
export { comparePresentation } from './compare.js';
export { focusPresentation } from './focus.js';
export type { FocusPresentationOptions } from './focus.js';
export type {
  AlignmentAxis,
  BaselineCluster,
  ElementReference,
  PaintInstruction,
  PaintLayer,
  PresentationComparison,
  PresentationAlignmentKind,
  PresentationAlignmentReading,
  PresentationFinding,
  PresentationFindingRule,
  PresentationHierarchyContract,
  PresentationHierarchyReading,
  PresentationHierarchyRole,
  PresentationFocus,
  PresentationFocusDepth,
  PresentationNode,
  PresentationRelation,
  PresentationReport,
  PresentationSpacingAxis,
  PresentationSpacingReading,
  PresentationSignature,
  PresentationTelemetry,
  ProminenceCluster,
  RepeatedPattern,
  SpacingCluster,
  SurfaceGroup,
} from './model.js';
