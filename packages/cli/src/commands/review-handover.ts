// compass: variance-authority/runtime/attention
import { codeUnitOrder } from '@variance-authority/core/segment';
import { declaredSuites } from '@variance-authority/sense/test-selection';
import type { ParsedReview } from '../review-args.js';
import { review, type Reach, type Review, type ReviewRegion } from './review.js';
import { functionOf, uncovered } from './review-scope.js';
import { eachSuite, type MissedSuite } from './review-suites.js';
import { FRESH_MARK, MARK, REACH_WORD } from './review-text.js';

/** The line a pull request body's handover starts at: a re-run replaces everything up to {@link HANDOVER_END}. */
export const HANDOVER_START = '<!-- variance-authority: handover -->';
export const HANDOVER_END = '<!-- /variance-authority: handover -->';

/**
 * Changed functions named one per line. A reviewer is handed where to look,
 * not the review: past this, the rest are counted, and `covering` reads any
 * one file in full.
 */
export const HANDOVER_LINES = 12;

/** One suite's reading of the change, or why its record could not be read. */
export type HandoverSection = { readonly suite?: string; readonly review: Review } | MissedSuite;

/**
 * What the change might do, read from each suite's record in this checkout,
 * for a reviewer who reads the pull request body before CI has run anything.
 * Every declared suite when none is named, a suite whose record cannot be read
 * saying why; the suite named, or the one record, fails the handover instead.
 */
export async function handover(request: ParsedReview): Promise<readonly HandoverSection[]> {
  // What local runs moved against the cases they retired is CI's to report, and a suite run twice at one commit cannot say it.
  const read = async (suite: string | undefined): Promise<HandoverSection> => ({
    ...(suite === undefined ? {} : { suite }),
    review: await review({
      command: 'review', root: request.root, format: request.format,
      ...(request.since === undefined ? {} : { since: request.since }),
      ...(suite === undefined ? {} : { suite }),
    }, { motion: false }),
  });
  if (request.suite !== undefined || declaredSuites(request.root) === undefined) return [await read(request.suite)];
  return eachSuite(request.root, read);
}

/** Nearest first in what a reviewer should open: nothing reached it, then new and not run yet, then reached only from afar. */
const ORDER: readonly (Reach | 'fresh')[] = ['hole', 'unwalked', 'unknown', 'fresh', 'loaded', 'unplaced', 'far', 'near'];
/** The same distances, counted. */
const COUNTED: Readonly<Record<Reach, string>> = {
  ...REACH_WORD, unplaced: 'at a distance not measured', loaded: 'run only while their module loaded',
};

/** One region of a changed function, as the suite that reached it nearest read it. */
interface Part {
  readonly file: string;
  readonly region: ReviewRegion;
  readonly suite?: string;
  /** Read from a run on this change, not from the record before it. */
  readonly ran: boolean;
  /** Written by this change and not run since: no case is expected yet. */
  readonly fresh: boolean;
}

/** One line: a changed function, its part furthest from a case, and its part a case came nearest. */
interface Crumb {
  readonly file: string;
  readonly name: string;
  readonly worst: Part;
  readonly reached?: Part;
}

/**
 * Breadcrumbs for the pull request body, folded: a person sees one line, a bot
 * reads them all. A function every case reached from a test file importing it
 * is only counted: the place to look is where that is not so.
 */
export function formatHandover(sections: readonly HandoverSection[]): string {
  const read = sections.filter((section): section is Extract<HandoverSection, { review: Review }> => 'review' in section);
  const crumbs = byFunction(nearestOfEach(read.flatMap(({ suite, review: answer }) => answer.files.flatMap((file) => (file.regions ?? []).map((region) => ({
    file: file.file, region, ...(suite === undefined ? {} : { suite }), ran: answer.record === 'ran',
    fresh: answer.record === 'before' && region.edit === 'new' && region.cases === 0,
  }))))));
  crumbs.sort((left, right) => rank(left.worst) - rank(right.worst) || (left.reached?.region.cases ?? 0) - (right.reached?.region.cases ?? 0) ||
    codeUnitOrder(left.file, right.file) || left.worst.region.startLine - right.worst.region.startLine);
  const named = crumbs.filter(({ worst }) => !(isReached(worst) && worst.region.reach === 'near'));
  const shown = named.slice(0, HANDOVER_LINES);
  const rest = crumbs.filter((crumb) => !shown.includes(crumb));
  const lines = [HANDOVER_START, `<details><summary>🧭 Coverage of the changed area: ${read.length === 0 ? 'no record read' : summary(crumbs)}</summary>`, ''];
  if (read.length > 0) lines.push(origin(read), '');
  const tagged = read.length > 1;
  lines.push(...shown.map((crumb) => crumbLine(crumb, tagged)));
  if (rest.length > 0) lines.push(...(shown.length === 0 ? [] : ['']), remainder(rest, shown.length > 0));
  for (const section of sections) {
    if ('missed' in section) {
      const why = section.unrecorded === true ? 'this checkout holds no case-level record of it' : firstSentence(section.missed);
      lines.push('', `${section.suite === undefined ? 'The record' : `\`${section.suite}\``} not read: ${why}.`);
    }
  }
  const from = read[0]?.review.from;
  if (from !== undefined && crumbs.length > 0) lines.push('', `More on one file: \`variance covering --since ${from.slice(0, 12)} --file <path>\``);
  lines.push('</details>', HANDOVER_END);
  return `${lines.join('\n')}\n`;
}

function summary(crumbs: readonly Crumb[]): string {
  if (crumbs.length === 0) return 'no changed function';
  const tops = crumbs.filter(({ name }) => name === TOP_LEVEL).length;
  const functions = crumbs.length - tops;
  const counted = [
    ...(functions > 0 || tops === 0 ? [`${functions} changed function${functions === 1 ? '' : 's'}`] : []),
    ...(tops === 0 ? [] : [`${tops} ${functions === 0 ? 'changed ' : ''}top level${tops === 1 ? '' : 's'}`]),
  ].join(' and ');
  const counts = new Map<string, number>();
  for (const { worst } of crumbs) {
    if (!isReached(worst)) counts.set(gapOf(worst), (counts.get(gapOf(worst)) ?? 0) + 1);
  }
  const reached = crumbs.length === 1 ? 'reached by a case' : crumbs.length === 2 ? 'both reached by a case' : 'every one reached by a case';
  return `${counted}, ${counts.size === 0 ? reached : [...counts].map(([gap, count]) => `${count} ${gap}`).join(', ')}`;
}

/** The function name a module's own top level is given. */
const TOP_LEVEL = 'the top level';

/** What a part no case reached lacks, in the words of the record it was read from, as the review comment words it. */
function gapOf(part: Part): string {
  if (part.fresh) return 'new and not run yet';
  return part.ran ? 'with code no case ran' : 'with code the record holds no case for';
}

/**
 * Each changed region once, answered for by the suite whose cases came nearest.
 * A suite that ran on the change and read the file is the word on what in it
 * the change touched, and what is new: a record from before the change can
 * only place the edit by its old lines, and counts what the edit moved as
 * written.
 */
function nearestOfEach(parts: readonly Part[]): Part[] {
  const keyOf = (part: Part) => `${part.file}\0${part.region.startLine}\0${part.region.endLine}\0${part.region.name}`;
  const ranParts = parts.filter((part) => part.ran);
  const ran = new Set(ranParts.map((part) => part.file));
  const touched = new Set(ranParts.map(keyOf));
  const nearest = new Map<string, Part>();
  for (const part of parts) {
    const key = keyOf(part);
    if (!part.ran && ran.has(part.file) && (part.fresh || !touched.has(key))) continue;
    const held = nearest.get(key);
    if (held === undefined || rank(part) > rank(held) || (rank(part) === rank(held) && part.region.cases > held.region.cases)) nearest.set(key, part);
  }
  // A module's own top level runs on any import: a near or loading one says nothing about the change.
  return [...nearest.values()].filter(({ region }) => !(region.kind === 'module' && (region.reach === 'near' || region.reach === 'loaded')));
}

/** A function's branches and closures on one line: the icon is its worst part, the test file its nearest reached one. */
function byFunction(parts: readonly Part[]): Crumb[] {
  const grouped = new Map<string, Part[]>();
  for (const part of parts) {
    const key = `${part.file}\0${functionOf(part.region)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), part]);
  }
  return [...grouped.values()].map((all) => {
    const held = all.filter((part) => !answeredElsewhere(part, all));
    const worst = held.reduce((left, right) => (rank(right) < rank(left) ? right : left));
    const reached = held.filter(isReached).reduce<Part | undefined>((best, part) =>
      best === undefined || rank(part) > rank(best) || (rank(part) === rank(best) && part.region.cases > best.region.cases) ? part : best, undefined);
    return { file: worst.file, name: functionOf(worst.region), worst, ...(reached === undefined ? {} : { reached }) };
  });
}

/**
 * Two suites can bound one function's regions differently, so a part one
 * suite never ran is answered by another that reached code overlapping it and
 * left none of that code unrun.
 */
function answeredElsewhere(part: Part, parts: readonly Part[]): boolean {
  if (isReached(part)) return false;
  const others = parts.filter((other) => other.suite !== part.suite &&
    other.region.startLine <= part.region.endLine && part.region.startLine <= other.region.endLine);
  return others.some(isReached) && others.every((other) => isReached(other));
}

function isReached(part: Part): boolean {
  return !part.fresh && !uncovered(part.region);
}

function rank(part: Part): number {
  return ORDER.indexOf(part.fresh ? 'fresh' : part.region.reach);
}

function origin(read: readonly { readonly suite?: string; readonly review: Review }[]): string {
  const ran = read.filter((section) => section.review.record === 'ran');
  // One suite read: its lines carry no tag, so this line names it.
  const only = read.length === 1 && read[0]!.suite !== undefined ? ` of \`${read[0]!.suite}\`` : '';
  if (ran.length === 0) return `Read from the record${only} before this change ran.`;
  if (ran.length === read.length) return `Read from the runs${only} on this change in this checkout.`;
  const named = ran.map((section) => `\`${section.suite}\``);
  return `Read from the runs on this change for ${[named.slice(0, -1).join(', '), named.at(-1)].filter(Boolean).join(' and ')}, and from the record before it for the rest.`;
}

function crumbLine({ file, name, worst, reached }: Crumb, tagged: boolean): string {
  const tag = tagged ? tagOf(worst) : '';
  const where = `${name === TOP_LEVEL ? name : `\`${name}\``} in \`${file}\``;
  // Every part reached: the furthest one is the one to read.
  if (isReached(worst)) return `- ${MARK[worst.region.reach]} ${where} — ${reachedBy(worst, false)}${tag}`;
  const reach = reached === undefined ? '' : reachedBy(reached, tagged && reached.suite !== worst.suite);
  const gap = worst.fresh
    ? (reached === undefined ? 'new, not run yet' : 'a new part not run yet')
    : worst.ran ? (reached === undefined ? 'no case' : 'a part no case ran') : reached === undefined ? 'no case in the record' : 'a part the record holds no case for';
  return `- ${worst.fresh ? FRESH_MARK : MARK[worst.region.reach]} ${where} — ${gap}${tag}${reach === '' ? '' : `; the rest ${reach}`}`;
}

/** How many cases reached a part, from how far, and the first test file to open. */
function reachedBy({ region, suite }: Part, tagged: boolean): string {
  const [first, ...others] = region.tests;
  const cases = region.cases === 0 ? '' : `${region.cases} case${region.cases === 1 ? '' : 's'}, `;
  const open = first === undefined ? '' : `: \`${first}\`${others.length === 0 ? '' : ` and ${others.length} more`}`;
  return `${cases}${REACH_WORD[region.reach]}${open}${tagged && suite !== undefined ? ` (\`${suite}\`)` : ''}`;
}

function tagOf({ suite }: Part): string {
  return suite === undefined ? '' : ` (\`${suite}\`)`;
}

function remainder(rest: readonly Crumb[], after: boolean): string {
  const counts = new Map<string, number>();
  for (const { worst } of rest) {
    const label = isReached(worst) ? COUNTED[worst.region.reach] : gapOf(worst);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const reached = rest.every(({ worst }) => isReached(worst)) ? 'every one reached by a case' : '';
  const listed = [...counts].map(([label, count]) => `${count} ${label}`).join(', ');
  if (after) return `And ${rest.length} more${reached === '' ? '' : `, ${reached}`}: ${listed}.`;
  // With nothing named, every crumb was reached from near.
  return `Every one reached by a case: ${listed}.`;
}

function firstSentence(message: string): string {
  const end = message.search(/[.:](\s|$)/u);
  return end < 0 ? message : message.slice(0, end);
}
