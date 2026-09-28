// compass: variance-authority.reach.crossings
/**
 * `variance coverage`: how much of what the suites loaded each suite ran, and
 * the regions that changed it since the base.
 *
 * Every number is a count `sense` takes over case indexes a run already wrote
 * (ADR-0081). This file finds the records and their bases and nothing else:
 * which suites exist is the root config's, where each records is sense's, and
 * the base is the record the suite's mainline published, which is the one
 * `review` reads — or the one `--against` names, for one record.
 *
 * The answer arrives with a comparison only when every counted suite has a
 * base. The ratio at the base is taken over the regions every base loaded, so a
 * base missing for one suite changes the denominator of all the others, and an
 * arrow drawn over it would compare two different totals.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  countCoverage,
  coverageChange,
  declaredSuites,
  recordedCommit,
  testCoverageFile,
  type CountedSuite,
  type CoverageCount,
  type DeclaredSuite,
  type SuiteChange,
  type SuiteKind,
} from '@variance-authority/sense/test-selection';
import type { ParsedCoverage } from '../coverage-args.js';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { baseCommit } from './covering-motion.js';
import { readExecutionIndex, recordedExecutionFile } from './execution-input.js';
import { mainlineBase, mainlineMissed } from './mainline-base.js';

/** One suite's record and its base, or why it has neither. */
export interface CoverageSuite {
  /** Absent for the one record of a repository that declares no suites. */
  readonly suite?: string;
  readonly kind?: SuiteKind;
  /** The case index counted. Absent when the suite has no record: it is unrecorded, never 0%. */
  readonly from?: string;
  /** The commit the record was made at, when it says. */
  readonly recorded?: string;
  /** Where the base came from, when the suite has one. */
  readonly base?: { readonly from: string; readonly commit?: string; readonly change: SuiteChange };
  /** Why the suite has no base. Absent when it has one, and when it has no record to compare. */
  readonly baseMissed?: string;
}

export interface Coverage {
  /** `HEAD`, when the root is in a checkout. */
  readonly at?: string;
  /** Every recorded suite counted over the regions any of them loaded. */
  readonly count: CoverageCount;
  /** In declaration order, recorded or not. */
  readonly suites: readonly CoverageSuite[];
  /** The same count over every base. Absent unless every recorded suite has one. */
  readonly base?: CoverageCount;
}

/** Count the records the request names, and compare them with their bases. */
export async function coverage(request: ParsedCoverage): Promise<Coverage> {
  const declared = asOperator(() => declaredSuites(request.root));
  const asked = request.suite === undefined ? declared : declared?.filter((one) => one.name === request.suite);
  if (request.suite !== undefined) asOperator(() => testCoverageFile(request.root, { suite: request.suite }));
  const counted: readonly (DeclaredSuite | undefined)[] = asked ?? [undefined];
  if (request.against !== undefined && counted.length > 1) {
    throw new OperatorError(
      `\`--against\` names one base, and the root variance.config.json declares ${counted.length} suites; ` +
        'pass `--suite <name>` to say which record it is the base of',
    );
  }

  const suites: CoverageSuite[] = [];
  const now: CountedSuite[] = [];
  const bases: CountedSuite[] = [];
  for (const one of counted) {
    const named = one === undefined ? {} : { suite: one.name, kind: one.kind };
    const from = await recordOf(request.root, one?.name);
    if (from === undefined) {
      suites.push(named);
      continue;
    }
    const index = await readExecutionIndex(from);
    const recorded = await recordedCommit(testCoverageFile(request.root, { suite: one?.name }));
    now.push({ ...(one === undefined ? {} : { name: one.name, kind: one.kind }), index });
    const found = await baseOf(request, one);
    if ('missed' in found) {
      suites.push({ ...named, from, ...(recorded === undefined ? {} : { recorded }), baseMissed: found.missed });
      continue;
    }
    const base = await readExecutionIndex(found.from);
    bases.push({ ...(one === undefined ? {} : { name: one.name, kind: one.kind }), index: base });
    suites.push({
      ...named,
      from,
      ...(recorded === undefined ? {} : { recorded }),
      base: { from: found.from, ...(found.commit === undefined ? {} : { commit: found.commit }), change: coverageChange(base, index) },
    });
  }

  if (now.length === 0) {
    throw new OperatorError(
      declared === undefined
        ? `nothing is recorded in \`${request.root}\`: no run left a per-case index. Run the suite with \`withTestSelection\` and ask again.`
        : `nothing is recorded in \`${request.root}\`: none of the suites it declares, ${
            counted.map((one) => `"${one!.name}"`).join(', ')
          }, has a per-case index. Run a suite with \`withTestSelection\` and ask again.`,
      { kind: 'unrecorded' },
    );
  }
  const at = await head(request.root);
  return {
    ...(at === undefined ? {} : { at }),
    count: countCoverage(now),
    suites,
    ...(bases.length === now.length ? { base: countCoverage(bases) } : {}),
  };
}

/** The per-case index a run left for a suite, or `undefined` when none did. */
async function recordOf(root: string, suite: string | undefined): Promise<string | undefined> {
  try {
    return await recordedExecutionFile(root, suite);
  } catch (error) {
    if (error instanceof OperatorError && error.kind === 'unrecorded') return undefined;
    throw error;
  }
}

/** The base a suite is compared with: `--against`, or its mainline's published record. */
async function baseOf(
  request: ParsedCoverage,
  suite: DeclaredSuite | undefined,
): Promise<{ readonly from: string; readonly commit?: string } | { readonly missed: string }> {
  if (request.against !== undefined) {
    const commit = await baseCommit(request.against);
    return { from: request.against, ...(commit === undefined ? {} : { commit }) };
  }
  const shared = await mainlineBase(request.root, suite);
  if (shared === undefined) {
    return {
      missed: suite === undefined
        ? 'no base: pass `--against <record>`'
        : `no base: "${suite.name}" is not given to the share, so pass \`--suite ${suite.name} --against <record>\``,
    };
  }
  if ('miss' in shared) return { missed: `no base: ${mainlineMissed(shared)}` };
  if (shared.cases === undefined) {
    return { missed: `no base: mainline ${shared.mainline} published no per-case index of "${shared.suite}"${shared.casesUnread === undefined ? '' : `: ${shared.casesUnread}`}` };
  }
  return { from: shared.cases, commit: shared.commit };
}

async function head(root: string): Promise<string | undefined> {
  try {
    return (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  } catch {
    return undefined;
  }
}

function asOperator<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new OperatorError(messageOf(error), { cause: error });
  }
}
