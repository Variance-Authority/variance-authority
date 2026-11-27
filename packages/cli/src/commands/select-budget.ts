// compass: variance-authority.reach
/**
 * `VARIANCE_AUTHORITY_BUDGET`: a ceiling of recorded test time on one run of
 * the selection, which the edit loop sets so it answers in seconds.
 *
 * The cut is a prefix ordered by containment: a changed file's own tests —
 * those in its package that enter it — shortest first, then its importers in
 * its package, then those in other packages, nearest first.
 * It only adds to `skip`, and a selection that declined to narrow skips
 * nothing (ADR-0062), so it cuts nothing there either, with one exception: a
 * local seam's suite run whole because the change moved a `before` entry is
 * cut to the test files the change edited, and the rest of the suite is CI's.
 */

import { isTestPath } from '@variance-authority/sense';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { durationText } from '@variance-authority/core/shard';
import type { SuiteTimes, TestDistance } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { packageOf } from '../package-home.js';
import type { SuiteReading, SuiteRequest } from './select-suite.js';
import { topLevel } from './since.js';
import { suiteTimes } from './suite-times.js';

/** The ceiling, in seconds, and whether a leg was asked beside it. */
export interface Budget {
  readonly seconds: number;
  /** A leg was asked: its importers are taken in order after the own tests, not left. */
  readonly asked: boolean;
}

/** How many left files the note names before it counts the rest. */
const NAMED = 10;

/** Own tests, importers in their package, importers in other packages, and tests placed by no path. */
type Tier = 0 | 1 | 2 | 3;

interface Candidate {
  readonly test: string;
  readonly tier: Tier;
  readonly hops: number;
  readonly price: number;
}

/**
 * The selection cut to what fits `budget`, by the record's `times`; `home`
 * names the package a repository-relative file is in.
 */
export function withinBudget(
  selection: SuiteReading,
  times: SuiteTimes,
  budget: Budget,
  home: (file: string) => string | undefined,
): SuiteReading {
  const variable = `\`VARIANCE_AUTHORITY_BUDGET=${budget.seconds}\``;
  const unchanged = (why: string): SuiteReading => ({
    ...selection,
    notes: [`${variable} cuts nothing: ${why}`, ...selection.notes],
    reading: { ...selection.reading, notes: [`${variable} cuts nothing: ${why}`, ...selection.reading.notes] },
  });
  if (selection.declined !== undefined) {
    // Only a local seam hands the change on, and only with a `before` reading: its suite runs whole by declaration, not by doubt.
    if (selection.reading.ground !== 'before' || selection.changed === undefined) {
      return unchanged('the selection did not narrow, and a selection that does not narrow skips nothing');
    }
    if ('unread' in times) return unchanged(times.unread);
    if (times.times.size === 0) return unchanged(`${times.recording} holds no test durations to price by`);
    return editedOnly({ ...selection, declined: selection.declined, changed: selection.changed }, times.times, budget);
  }
  // A selection `--local` fell to holds no hops to rank by, and its rung already chose by containment.
  if (selection.reading.fell !== undefined) return unchanged(`the selection fell to the ${selection.reading.fell.rung} \`--local\` chose, which holds no hops to rank by`);
  // The leg leaves a selection on a stale, widened or unread graph uncut and measures no hops; the budget would rank all of it last.
  if (selection.reading.distances === undefined) return unchanged('the leg measured no hops to rank by, and left the selection whole');
  if ('unread' in times) return unchanged(times.unread);
  if (times.times.size === 0) return unchanged(`${times.recording} holds no test durations to price by`);

  const candidates = ranked(selection, times.times, home);
  const taken: Candidate[] = [];
  const cut: Candidate[] = [];
  let spent = 0;
  for (const candidate of candidates) {
    const fits = cut.length === 0 && (budget.asked || candidate.tier === 0) && spent + candidate.price <= budget.seconds * 1000;
    if (fits) {
      taken.push(candidate);
      spent += candidate.price;
    } else cut.push(candidate);
  }
  const total = candidates.reduce((sum, candidate) => sum + candidate.price, 0);
  const ran = `${variable} ran ${taken.length} of ${candidates.length} selected, ${durationText(spent)} of ${durationText(total)} recorded`;
  if (cut.length === 0) return { ...selection, notes: [ran, ...selection.notes], reading: { ...selection.reading, notes: [ran, ...selection.reading.notes] } };

  const notes = [
    `${ran}; ${cut.length} ${cut.length === 1 ? 'is' : 'are'} left for CI:`,
    ...cut.slice(0, NAMED).map((candidate) => `  ${candidate.test}, ${durationText(candidate.price)}`),
    ...(cut.length > NAMED ? [`  and ${cut.length - NAMED} more`] : []),
    ...(budget.asked || !cut.some((candidate) => candidate.tier !== 0)
      ? []
      : ['`VARIANCE_AUTHORITY_AT_DISTANCE=0-` takes the rest in order, under the same budget, after the own tests']),
  ];
  const left = cut.map((candidate) => candidate.test);
  const skip = new Set([...selection.skip, ...left]);
  const all = new Set([...(selection.left ?? []), ...left]);
  const only = selection.only === undefined ? undefined : new Set([...selection.only].filter((test) => !skip.has(test)));
  return {
    ...selection,
    skip,
    left: all,
    ...(only === undefined ? {} : { only }),
    notes: [...notes, ...selection.notes],
    reading: {
      ...selection.reading,
      skip: [...skip].sort(),
      left: [...all].sort(),
      ...(only === undefined ? {} : { only: [...only].sort() }),
      notes: [...notes, ...selection.reading.notes],
    },
  };
}

/**
 * A suite run whole because a local change moved a `before` entry, cut to the
 * test files the change edited: those the record times, shortest first, as
 * many as fit, and every test by its name the record does not time, which the
 * runner collects or not, as the local ladder hands one on. Every other test
 * file of the suite is left for CI, which runs it whole (ADR-0102).
 */
function editedOnly(
  selection: SuiteReading & { readonly declined: string; readonly changed: readonly string[] },
  times: ReadonlyMap<string, number>,
  budget: Budget,
): SuiteReading {
  const variable = `\`VARIANCE_AUTHORITY_BUDGET=${budget.seconds}\``;
  const changed = [...new Set(selection.changed)];
  const timed = changed
    .filter((file) => times.has(file))
    .map((test) => ({ test, price: times.get(test)! }))
    .sort((a, b) => a.price - b.price || codeUnitOrder(a.test, b.test));
  // Untimed, a test may be new or another suite's: the runner's discovery says which, and it costs no budget it can be charged.
  const untimed = changed.filter((file) => !times.has(file) && isTestPath(file)).sort(codeUnitOrder);
  const taken: string[] = [];
  let spent = 0;
  // A prefix, as the own tier is taken: the first that would pass the ceiling ends it.
  for (const { test, price: ms } of timed) {
    if (spent + ms > budget.seconds * 1000) break;
    taken.push(test);
    spent += ms;
  }
  const cut = timed.slice(taken.length);
  const ran =
    `${variable} ran ${taken.length} of the ${timed.length} timed test file${timed.length === 1 ? '' : 's'} the change edited, ${durationText(spent)} recorded` +
    (untimed.length === 0 ? '' : `, and ${untimed.length} it does not time`) +
    `; every other test file of the suite is left for CI, which runs it whole: ${selection.declined}`;
  const notes = [
    ran,
    ...(cut.length === 0 ? [] : [`${cut.length} edited ${cut.length === 1 ? 'is' : 'are'} left for CI too:`]),
    ...cut.slice(0, NAMED).map((candidate) => `  ${candidate.test}, ${durationText(candidate.price)}`),
    ...(cut.length > NAMED ? [`  and ${cut.length - NAMED} more`] : []),
    ...(untimed.length === 0 ? [] : ['untimed, run if this suite collects them:']),
    ...untimed.slice(0, NAMED).map((test) => `  ${test}`),
    ...(untimed.length > NAMED ? [`  and ${untimed.length - NAMED} more`] : []),
  ];
  // A shard placement would add its waves back, and the suite would run whole again.
  const { declined: _declined, placing: _placing, ...narrowed } = selection;
  const only = new Set([...taken, ...untimed]);
  return {
    ...narrowed,
    only,
    notes: [...notes, ...selection.notes],
    reading: { ...selection.reading, only: [...only].sort(codeUnitOrder), notes: [...notes, ...selection.reading.notes] },
  };
}

/**
 * The files the selection runs, as far as the record names them, in the order
 * a budget takes them. Not the shard placement in `core/shard`, which balances
 * every file across machines: this picks which fit one, and prices an untimed
 * file at the slowest of its package, so a ceiling stays a ceiling.
 */
function ranked(selection: SuiteReading, times: ReadonlyMap<string, number>, home: (file: string) => string | undefined): readonly Candidate[] {
  const distances = new Map<string, TestDistance>((selection.reading.distances ?? []).map((distance) => [distance.test, distance]));
  const named = new Set([...selection.whole, ...(selection.reading.incomplete ?? []), ...distances.keys()]);
  const runs = [...named].filter((test) => !selection.skip.has(test) && (selection.only === undefined || selection.only.has(test)));

  const slowest = new Map<string | undefined, number>();
  let anywhere = 0;
  for (const [test, ms] of times) {
    const at = home(test);
    slowest.set(at, Math.max(slowest.get(at) ?? 0, ms));
    anywhere = Math.max(anywhere, ms);
  }
  const price = (test: string) => times.get(test) ?? slowest.get(home(test)) ?? anywhere;

  return runs
    .map((test): Candidate => {
      const distance = distances.get(test);
      const hops = distance?.hops;
      return { test, tier: tierOf(test, distance, home), hops: hops ?? Number.MAX_SAFE_INTEGER, price: price(test) };
    })
    // Own tests are taken by recorded duration alone; importers nearest first, then by duration.
    .sort((a, b) => a.tier - b.tier || (a.tier === 0 ? 0 : a.hops - b.hops) || a.price - b.price || codeUnitOrder(a.test, b.test));
}

/**
 * A test's own file, setup or configuration changed (0 hops), or it enters a
 * changed file of its own package — imports it directly, and through no other
 * module it imports (`enters`): own. Otherwise, in that package or another, it
 * is an importer. With no measured path it is placed by none.
 */
function tierOf(test: string, distance: TestDistance | undefined, home: (file: string) => string | undefined): Tier {
  if (distance?.hops === undefined) return 3;
  const at = home(test);
  if (distance.hops === 0 || distance.enters?.some((file) => home(file) === at) === true) return 0;
  return distance.from === undefined || home(distance.from) === at ? 1 : 2;
}

/**
 * The selection `select` answers for `request`, cut to its budget: the
 * changed files' own tests, as many as fit, unless a leg was asked.
 */
export async function budgetedSuite(
  request: SuiteRequest & { readonly budget: number },
  select: (request: SuiteRequest) => Promise<SuiteReading>,
): Promise<SuiteReading> {
  const { budget, ...unbudgeted } = request;
  const asked = unbudgeted.atDistance !== undefined;
  // The open leg cuts nothing and measures every hop, so which tests are own is decided once, by the tier.
  const selection = await select(asked ? unbudgeted : { ...unbudgeted, atDistance: { from: 0, to: Number.MAX_SAFE_INTEGER, by: 'environment' } });
  const times = await timesOf(unbudgeted);
  const top = (await topLevel(unbudgeted.root)) ?? unbudgeted.root;
  return withinBudget(selection, times, { seconds: budget, asked }, (file) => packageOf(top, file));
}

/** The record's times, or why there are none: a share that did not answer leaves the loop uncut, and `explain` unpriced, rather than failed. */
export async function timesOf(request: SuiteRequest): Promise<SuiteTimes> {
  try {
    return await suiteTimes({ root: request.root, ...(request.suite === undefined ? {} : { suite: request.suite }), ...(request.beneath === true ? { beneath: true } : {}) });
  } catch (error) {
    if (error instanceof OperatorError) return { unread: error.message };
    throw error;
  }
}
