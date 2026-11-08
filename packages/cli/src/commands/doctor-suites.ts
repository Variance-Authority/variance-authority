// compass: variance-authority.reach

import type { RecordOrigin } from '@variance-authority/sense/test-selection';
import { asOperator } from './suite-record.js';
import { recordHeld, selectedMainline } from './mainline-selected.js';

/**
 * Whether each declared suite has recorded, as this machine holds it. Only a
 * runner's config says whether it is wrapped, so the record a wrapped run leaves
 * is what is observed. Not recorded yet is the state before a first run, so this
 * never moves the exit code.
 */
export interface SuitesFinding {
  readonly suites: readonly SuiteReading[];
}

export interface SuiteReading {
  readonly name: string;
  readonly kind: string;
  /** The record a reader would open, or this checkout's own when none is held. */
  readonly file: string;
  /** Whose record that is; absent when no layer holds one. */
  readonly origin?: RecordOrigin;
}

/** The finding for the repository at `root`; absent when its root config declares no suite. */
export async function suitesFinding(root: string): Promise<SuitesFinding | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = asOperator(() => selection.declaredSuites(root));
  if (declared === undefined) return undefined;
  const suites: SuiteReading[] = [];
  for (const suite of declared) {
    const own = asOperator(() => selection.testCoverageFile(root, { suite: suite.name }));
    // The selection is a git process or two, worked out only when the
    // checkout's own record does not answer first, as a reader works it out.
    const selected = (await recordHeld(own)) ? undefined : await selectedMainline(root, suite);
    const { file, origin } = asOperator(() => selection.nearestRecord(root, { suite: suite.name, selected }));
    const held = origin !== 'own' || (await recordHeld(file));
    suites.push(held ? { name: suite.name, kind: suite.kind, file, origin } : { name: suite.name, kind: suite.kind, file });
  }
  return { suites };
}

const FROM: Record<RecordOrigin, string> = {
  own: 'recorded in this checkout',
  mainline: "not recorded in this checkout; a reader opens the mainline's record as last fetched",
  primary: "not recorded in this checkout; a reader opens the primary checkout's record",
};

export function formatSuites(finding: SuitesFinding): readonly string[] {
  const count = finding.suites.length;
  return [
    `suites: ${count} declared in the root variance.config.json`,
    ...finding.suites.flatMap((suite) => [
      `  ${suite.name} (${suite.kind}): ${suite.origin === undefined ? 'not recorded yet' : FROM[suite.origin]}`,
      suite.origin === undefined ? `    ${writer(suite)} writes ${suite.file}` : `    ${suite.file}`,
    ]),
  ];
}

/** What writes a suite's first record. */
function writer(suite: SuiteReading): string {
  return suite.kind === 'job'
    ? `\`variance job --suite ${suite.name} -- <command>\``
    : "a run of its runner, with that runner's config wrapped by its seam's `withTestSelection`,";
}
