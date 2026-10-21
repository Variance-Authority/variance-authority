import type { FlakinessRecord, ObservationRecord, RunReport } from './format.js';

/**
 * The subjects that disagreed with themselves, folded once for every reader.
 *
 * The pull-request comment, the report page and the MCP summary each say which
 * subjects were unstable, what moved between the two readings, and what the
 * history record knows about them. They differ in how they spell a line, never
 * in which subjects are listed or what is known about each, so that half lives
 * here and each surface only renders it.
 */

/**
 * The sentence for a subject no history store answered about.
 *
 * Absent is not "first time": silence would read as the one claim the record
 * exists to make or refuse, so every surface says this instead.
 */
export const NO_RECORD = 'No history record: recurrence unknown';

/**
 * Whether two readings of this subject disagreed outside what it declared it
 * asserts on. Such a subject holds the run open and cannot be accepted; an
 * absorbed instability is neither.
 */
export function isUnstable<T extends { readonly unstable?: { readonly absorbed?: unknown } }>(
  observation: T,
): observation is T & { readonly unstable: NonNullable<T['unstable']> } {
  return observation.unstable !== undefined && observation.unstable.absorbed === undefined;
}

/**
 * One subject whose two readings disagreed outside what it asserts on: what moved
 * between them, and what the history store knows about it. A surface renders
 * these; it does not decide which subjects they are.
 */
export interface UnstableSubject {
  readonly subject: string;
  readonly components: NonNullable<ObservationRecord['unstable']>['components'];
  readonly bands: readonly string[];
  /** What the history store knows. Absent: none answered, see {@link NO_RECORD}. */
  readonly record?: FlakinessRecord;
}

/**
 * Every unabsorbed instability in report order, and whether no subject among
 * them has a record — which is every subject of a run with no history
 * configured, and is said once rather than per subject.
 */
export function unstableOf(report: Pick<RunReport, 'observations' | 'flakiness'>): {
  readonly subjects: readonly UnstableSubject[];
  readonly unrecorded: boolean;
} {
  const subjects = report.observations.filter(isUnstable).map((observation): UnstableSubject => {
    const { components, bands } = observation.unstable;
    const record = report.flakiness?.[observation.subject];
    return { subject: observation.subject, components, bands, ...(record === undefined ? {} : { record }) };
  });
  return { subjects, unrecorded: subjects.every((entry) => entry.record === undefined) };
}
