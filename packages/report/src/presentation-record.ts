/**
 * What a presentation reading contributes to a regression report.
 *
 * Beside `format.ts` rather than inside it for the reason `finding-record.ts` is:
 * the record types a report carries are one shape each, and a file holding every
 * shape at once is read by nobody looking for one of them.
 */

import type { Digest } from '@variance-authority/core/format';

/** How one relationship condition changed between comparable presentation readings. */
export type PresentationEffectTransition = 'introduced' | 'resolved' | 'persisted';

/** The finding-local measurement retained on one side of a presentation effect. */
export interface PresentationEffectEvidence {
  /** Finding id in the corresponding presentation report or hierarchy reading. */
  readonly finding: string;
  readonly measurements: Readonly<Record<string, number | string>>;
}

/** One relationship consequence attributable to the difference between two readings. */
export interface PresentationEffectRecord {
  readonly rule: string;
  readonly transition: PresentationEffectTransition;
  readonly owner: string;
  readonly nodes: readonly string[];
  readonly pattern?: string;
  readonly contract?: string;
  readonly before?: PresentationEffectEvidence;
  readonly after?: PresentationEffectEvidence;
}

/** Information-volume evidence kept beside relationship effects. */
export interface PresentationInformationRecord {
  readonly contentPreserved: boolean;
  readonly characters: { readonly before: number; readonly after: number; readonly delta: number };
  readonly elements: { readonly before: number; readonly after: number; readonly delta: number };
  readonly repeatedObjects: { readonly before: number; readonly after: number; readonly delta: number };
}

/**
 * Presentation evidence carried by a general regression report.
 *
 * `incomparable` has no effects: inventing a transition from one reading would
 * turn absence into evidence. Comparable readings always carry `effects`, where
 * an empty array means the presentation consequence was measured and unchanged.
 */
export type PresentationSignalRecord =
  | {
      readonly verdict: 'incomparable';
      readonly because: string;
      readonly before?: Digest;
      readonly after?: Digest;
    }
  | {
      readonly verdict: 'unchanged' | 'changed';
      readonly before: Digest;
      readonly after: Digest;
      readonly information: PresentationInformationRecord;
      readonly effects: readonly PresentationEffectRecord[];
    };

