export { createEyesArchive, createEyesLog, eyesTestAttention } from './access.js';
export type {
  ArgumentSnapshot,
  Attention,
  AttentionDraft,
  ConsumedLocatorAttention,
  DocumentEventAttention,
  EyesArchive,
  EyesLog,
  EyesPhase,
  EyesTestAttention,
  EyesTestIdentity,
  LocatorStep,
  PlannedLocatorAttention,
  PhaseAttention,
  ReactCommitAttention,
  ReactTapRefusedAttention,
  RtlQueryAttention,
  TargetSnapshot,
} from './access.js';
export { snapshotNode } from './snapshot.js';
// Re-exported so installing Eyes is one box, not two: the adopter must call
// this themselves before `react-dom` loads, and a surface that sends them to
// another package to do it has not finished being a surface (ADR-0024).
export { tapCommits } from '@variance-authority/react';
export type { TapRefusal } from '@variance-authority/react';
