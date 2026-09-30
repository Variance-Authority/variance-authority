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
  askCoverageFile,
  countCoverage,
  coverageChange,
  declaredSuites,
  readableTestCoverage,
  recordedCommit,
  sharedPreconditions,
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
import { coverageSource, harnessReach, readSource, within, type CoverageSource, type MissedEntry, type Scoped } from './coverage-source.js';
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
  /** The source in scope, with the files no suite recorded. Absent when the source index could not be read. */
  readonly source?: CoverageSource;
  /** Why `source` is absent. */
  readonly sourceMissed?: string;
  /** Each package with `--packages`, or each directory the root config declares entry points for, counted over its own files and over everything it reaches. Absent with `--from`. */
  readonly entries?: readonly (CoverageEntry | MissedEntry)[];
  /**
   * The files changed since the commit every base was recorded at, when no
   * counted suite loads any of them and no suite's count changed. Absent
   * whenever git or a record cannot say so, and whenever the change is
   * anything else: the whole count is then the answer.
   */
  readonly unloadedChange?: UnloadedChange;
}

/** A change no suite loads: the files git says changed, and since which commit. */
export interface UnloadedChange {
  readonly since: string;
  /** In code-unit order. */
  readonly files: readonly string[];
}

/** Count the records the request names, and compare them with their bases. */
/** One directory counted on its own. */
export interface CoverageEntry {
  readonly from: string;
  readonly own: CoverageSource;
  readonly uses: CoverageSource;
}

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

  // Read first: `--from` narrows every record counted below to the files it reaches.
  const reading = await readSource(request.root, request.from, request.packages === true);
  if ('missed' in reading && request.from !== undefined) {
    throw new OperatorError(`\`--from ${request.from}\` is answered by the source index, and ${reading.missed}`);
  }
  const scope = 'missed' in reading ? undefined : reading.scope;
  const suites: CoverageSuite[] = [];
  const now: CountedSuite[] = [];
  const bases: CountedSuite[] = [];
  const harness = new Set<string>();
  // Every file a counted suite loads: the modules it instrumented, its test
  // files, and what every test rests on. Unscoped, because `--from` narrows
  // the count, not what the suites load.
  const loaded = new Set<string>();
  for (const one of counted) {
    const named = one === undefined ? {} : { suite: one.name, kind: one.kind };
    // The record and everything read beside it come from one cache layer: the
    // nearest that holds it, which in a worktree that has not run is the
    // primary checkout's.
    const record = await readableTestCoverage(request.root, { suite: one?.name });
    const from = await recordOf(request.root, one?.name, record);
    if (from === undefined) {
      suites.push(named);
      continue;
    }
    const whole = await readExecutionIndex(from);
    for (const module of whole.modules) loaded.add(module.file);
    for (const test of whole.tests) loaded.add(test.file);
    const index = within(whole, scope);
    const recorded = await recordedCommit(record);
    for (const entry of restsOn(record)) harness.add(entry);
    now.push({ ...(one === undefined ? {} : { name: one.name, kind: one.kind }), index });
    const found = await baseOf(request, one);
    if ('missed' in found) {
      suites.push({ ...named, from, ...(recorded === undefined ? {} : { recorded }), baseMissed: found.missed });
      continue;
    }
    const base = within(await readExecutionIndex(found.from), scope);
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
  const count = countCoverage(now);
  const indexes = now.map((one) => one.index);
  const reach = 'missed' in reading ? undefined : harnessReach(reading.records, [...harness].sort());
  for (const entry of harness) loaded.add(entry);
  const unloadedChange = await changeNoSuiteLoads(request.root, suites, loaded);
  return {
    ...(at === undefined ? {} : { at }),
    count,
    suites,
    ...(bases.length === now.length ? { base: countCoverage(bases) } : {}),
    ...(unloadedChange === undefined ? {} : { unloadedChange }),
    ...('missed' in reading
      ? { sourceMissed: reading.missed }
      : {
          source: coverageSource(reading, indexes, count, reach),
          ...(reading.entries === undefined ? {} : {
            entries: reading.entries.map((entry) => {
              if ('missed' in entry) return entry;
              const counted = (part: Scoped) => {
                const narrowed = now.map((one) => ({ ...one, index: within(one.index, part.scope) }));
                return coverageSource(part, narrowed.map((one) => one.index), countCoverage(narrowed), reach);
              };
              return { from: entry.from, own: counted(entry.own), uses: counted(entry.uses) };
            }),
          }),
        }),
  };
}

/** The per-case index a run left for a suite, or `undefined` when none did. */
/**
 * What every test in the recording rests on, or nothing when the recording
 * cannot be opened: the count over the case index stands without it, and the
 * files the harness loads are then listed with the files nothing loaded.
 */
function restsOn(file: string): readonly string[] {
  try {
    return askCoverageFile(file, sharedPreconditions);
  } catch {
    return [];
  }
}

async function recordOf(root: string, suite: string | undefined, record: string): Promise<string | undefined> {
  try {
    return await recordedExecutionFile(root, suite, record);
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

/**
 * The files changed since the one commit every base was recorded at, when no
 * counted suite loads any of them and no suite's count changed. Git says what
 * changed, the working tree included; the records say what the suites load.
 * A declared suite with no record, a base with no commit, bases at two
 * commits, a git that cannot answer, no changed file, or one changed file a
 * suite loads: each leaves the answer to the whole count.
 */
async function changeNoSuiteLoads(
  root: string,
  suites: readonly CoverageSuite[],
  loaded: ReadonlySet<string>,
): Promise<UnloadedChange | undefined> {
  const bases = suites.map((suite) => suite.base);
  if (bases.length === 0 || bases.some((base) => base === undefined || !unchanged(base.change))) return undefined;
  const commits = new Set(bases.map((base) => base!.commit));
  const [since] = commits;
  if (commits.size !== 1 || since === undefined) return undefined;
  let names: string;
  try {
    names = (await promisify(execFile)('git', ['diff', '--name-only', '--no-renames', since], { cwd: root })).stdout;
  } catch {
    return undefined;
  }
  const files = names.split('\n').filter((file) => file !== '').sort();
  if (files.length === 0 || files.some((file) => loaded.has(file))) return undefined;
  return { since, files };
}

/** Whether a suite's count is the base's, part for part. */
function unchanged(change: SuiteChange): boolean {
  return change.gained === 0 && change.lost === 0 && change.hidden === 0 && change.thinned === 0 &&
    change.written.regions === 0 && change.deleted.regions === 0 &&
    change.arrived.files.length === 0 && change.departed.files.length === 0 &&
    change.testFiles.every((file) => file.entered.length === 0 && file.left.length === 0);
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
