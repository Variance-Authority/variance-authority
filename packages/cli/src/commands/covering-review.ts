/**
 * A review of a diff, in the shape a code host draws beside the lines.
 *
 * Each host already carries annotations on a pull request, so the record rides
 * them rather than shipping an extension: GitHub reads workflow commands a step
 * prints, and Bitbucket Cloud reads a Code Insights report and its annotations.
 * Both are asked `--since` on the commit under review, and both are given the
 * same regions in the same order — holes first, because a hole is the one a
 * reviewer cannot see from the diff — so the two hosts never disagree about
 * what a change left unwalked.
 *
 * A walked region is not annotated. It is the ordinary state of tested code,
 * and a pull request painted over every line of it hides the ones that need a
 * reader. The host's own limits decide how many annotations are drawn; the
 * order decides which.
 */

import type { RangeState } from '@variance-authority/sense/test-selection';
import type { Covering, ReviewFormat, StatedRegion } from './covering.js';

/**
 * What a review draws in one place: the regions of one function that share a
 * state. A function with a branch, a loop and a callback left unentered is one
 * thing for a reviewer to read, and GitHub draws only ten notices from a step,
 * so one annotation per region spent them on the parts of two functions.
 */
interface Marked {
  readonly path: string;
  /** The function the parts belong to: a region's name up to its first `/`. */
  readonly name: string;
  readonly parts: readonly StatedRegion[];
  readonly state: RangeState | 'unentered';
}

/** Bitbucket takes at most this many annotations in one request. */
const BITBUCKET_BATCH = 100;

/** Bitbucket keeps at most this many annotations on one report. */
const BITBUCKET_KEPT = 1000;

const RANK: Record<Marked['state'], number> = { hole: 0, unentered: 1, unwalked: 2, alone: 3, loaded: 4, walked: 5 };

/** Write a `--since` answer as one host's review. */
export function formatReview(answer: Covering, format: ReviewFormat): string {
  const marked = regionsOf(answer);
  if (format === 'github') return marked.map(workflowCommand).map((line) => `${line}\n`).join('');
  if (format === 'markdown') return markdown(answer, marked);
  if (format === 'bitbucket-annotations') {
    // One request body per line, so a pipeline posts them with a `while read`
    // loop and needs no JSON tool to cut them.
    const kept = marked.slice(0, BITBUCKET_KEPT).map(annotation);
    const batches: string[] = [];
    for (let start = 0; start < kept.length; start += BITBUCKET_BATCH) {
      batches.push(`${JSON.stringify(kept.slice(start, start + BITBUCKET_BATCH))}\n`);
    }
    return batches.join('');
  }
  return `${JSON.stringify(report(answer, marked), undefined, 2)}\n`;
}

function regionsOf(answer: Covering): readonly Marked[] {
  const prefix = answer.directory === undefined || answer.directory === '' ? '' : `${answer.directory}/`;
  const groups = new Map<string, { path: string; name: string; state: Marked['state']; parts: StatedRegion[] }>();
  for (const file of answer.changed ?? []) {
    for (const region of file.regions) {
      const state = region.state ?? (region.tests.length === 0 ? 'unentered' : 'walked');
      // A module's top level running while it loads is the ordinary state of a
      // module, and says nothing about the code it declares.
      if (state === 'walked' || (state === 'loaded' && region.kind === 'module')) continue;
      const path = `${prefix}${file.file}`;
      const name = region.name.split('/')[0]!;
      const key = `${path}\0${name}\0${state}`;
      const group = groups.get(key) ?? { path, name, state, parts: [] };
      group.parts.push(region);
      groups.set(key, group);
    }
  }
  const marked = [...groups.values()].map((group) => ({
    ...group,
    parts: group.parts.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine),
  }));
  return marked.sort((left, right) => RANK[left.state] - RANK[right.state]);
}

const startOf = (marked: Marked): number => marked.parts[0]!.startLine;
const endOf = (marked: Marked): number => Math.max(...marked.parts.map((part) => part.endLine));

/** The sentence a reviewer reads beside the regions. */
function summary(marked: Marked): string {
  const { state } = marked;
  const parts = outermost(marked.parts);
  const one = parts.length === 1;
  const what = one ? described(parts[0]!) : `${parts.length} regions of ${labelOf(marked)} (${lines(parts)})`;
  const it = one ? 'it' : 'them';
  const stopped = unique(parts.flatMap((part) => part.stopped ?? []));
  const tests = unique(parts.flatMap((part) => part.tests));
  switch (state) {
    case 'hole':
      return `No case entered ${what}, and ${stopped.length === 1 ? 'a case' : `${stopped.length} cases`} ` +
        `that could have reached ${it} stopped first: ${stopped.map((test) => test.name).join(', ')}.`;
    case 'unwalked':
      return `No case entered ${what}, and every case that could have reached ${it} finished.`;
    case 'unentered':
      return `No case entered ${what}.`;
    case 'alone':
      return `One case entered ${what}: ${tests.map((test) => `${test.name} (${test.file})`).join(', ')}.`;
    case 'loaded':
      return `${what} ran only while its module loaded; no case called into ${it}.`;
    default:
      return `${what} was entered by ${tests.length} cases.`;
  }
}

/**
 * The parts no other part holds. A function nothing entered holds its branches
 * and loops, and naming them again says nothing the function did not.
 */
function outermost(parts: readonly StatedRegion[]): StatedRegion[] {
  const kept: StatedRegion[] = [];
  let reach = 0;
  for (const part of parts) {
    if (part.endLine <= reach) continue;
    kept.push(part);
    reach = part.endLine;
  }
  return kept;
}

/** A module's region is its top level, which has no name of its own. */
function described(region: StatedRegion): string {
  return region.kind === 'module' ? 'the top level of this module' : `${region.kind} ${region.name}`;
}

function labelOf(marked: Marked): string {
  return marked.name === '' ? 'the top level' : marked.name;
}

/** Where each part starts, and where it ends when that is another line. */
function lines(parts: readonly StatedRegion[]): string {
  const spans = parts.map((part) => part.endLine === part.startLine ? `${part.startLine}` : `${part.startLine}–${part.endLine}`);
  return `line${spans.length === 1 ? '' : 's'} ${spans.join(', ')}`;
}

/** Each case once, by identity, in the order first met. */
function unique<Case extends { readonly id: string }>(cases: readonly Case[]): Case[] {
  const seen = new Map<string, Case>();
  for (const test of cases) if (!seen.has(test.id)) seen.set(test.id, test);
  return [...seen.values()];
}

const TITLE: Record<Marked['state'], string> = {
  hole: 'Hole',
  unentered: 'Not entered',
  unwalked: 'Unwalked',
  alone: 'One case',
  loaded: 'Loaded only',
  walked: 'Walked',
};

/**
 * One GitHub workflow command. A hole is a warning, because a stopped case hid
 * the region from the record; the rest are notices.
 */
function workflowCommand(marked: Marked): string {
  const level = marked.state === 'hole' ? 'warning' : 'notice';
  const properties = [
    `file=${property(marked.path)}`,
    `line=${startOf(marked)}`,
    `endLine=${endOf(marked)}`,
    `title=${property(`${TITLE[marked.state]}: ${labelOf(marked)}`)}`,
  ].join(',');
  return `::${level} ${properties}::${data(summary(marked))}`;
}

// GitHub's own escaping for workflow commands: the message escapes `%` and line
// breaks, and a property also escapes the `:` and `,` its syntax is made of.
function data(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function property(text: string): string {
  return data(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

/** One Bitbucket Code Insights annotation. */
function annotation(marked: Marked): Record<string, unknown> {
  const text = summary(marked);
  return {
    external_id: `${marked.path}:${marked.name}:${marked.state}`,
    annotation_type: 'CODE_SMELL',
    path: marked.path,
    line: startOf(marked),
    // Bitbucket refuses a summary longer than 450 characters; the whole sentence
    // goes in the details.
    summary: text.length > 450 ? `${text.slice(0, 449)}…` : text,
    details: text,
    severity: marked.state === 'hole' ? 'MEDIUM' : 'LOW',
  };
}

/** The Bitbucket Code Insights report the annotations hang from. */
function report(answer: Covering, marked: readonly Marked[]): Record<string, unknown> {
  const regions = (answer.changed ?? []).flatMap((file) => file.regions);
  // Counted in regions, as the details line counts them; an annotation is a group of them.
  const count = (state: Marked['state']): number => countOf(marked, state);
  const drawn = Math.min(marked.length, BITBUCKET_KEPT);
  const silent = (answer.changed ?? []).filter((file) => !file.recorded).length;
  return {
    title: 'What the suite walked',
    details: `${regions.length} changed region${regions.length === 1 ? '' : 's'}${
      answer.since === undefined ? '' : ` since ${answer.since}`
    }. ${drawn === marked.length
      ? `${marked.length} annotation${marked.length === 1 ? '' : 's'}`
      : `${drawn} of ${marked.length} annotations, holes first; Bitbucket keeps no more on one report`}.`,
    report_type: 'COVERAGE',
    reporter: 'variance',
    data: [
      { title: 'Changed regions', type: 'NUMBER', value: regions.length },
      { title: 'Holes', type: 'NUMBER', value: count('hole') },
      { title: 'Nothing entered', type: 'NUMBER', value: count('unentered') + count('unwalked') + count('hole') },
      { title: 'One case', type: 'NUMBER', value: count('alone') },
      { title: 'Changed files the record does not hold', type: 'NUMBER', value: silent },
      ...(answer.at === undefined ? [] : [{ title: 'Recorded at', type: 'TEXT', value: answer.at.slice(0, 12) }]),
    ],
  };
}

/**
 * The whole review as Markdown, for the places a host renders it: a GitHub step
 * summary, a pull request comment. Nothing here is cut, so it is where a reader
 * finds the annotations a host's limit did not draw.
 */
function markdown(answer: Covering, marked: readonly Marked[]): string {
  const regions = (answer.changed ?? []).flatMap((file) => file.regions);
  const walked = regions.length - marked.reduce((sum, entry) => sum + entry.parts.length, 0);
  const counts = (Object.keys(PHRASE) as Marked['state'][])
    .map((state) => [state, state === 'walked' ? walked : countOf(marked, state)] as const)
    .filter(([, value]) => value > 0)
    .map(([state, value]) => `${value} ${state === 'hole' && value === 1 ? 'hole' : PHRASE[state]}`);
  const since = answer.since === undefined ? '' : ` since \`${answer.since}\``;
  const at = answer.at === undefined ? '' : `, recorded at \`${answer.at.slice(0, 12)}\``;
  const out = [
    '### What the suite walked',
    '',
    `${regions.length} changed region${regions.length === 1 ? '' : 's'}${since}${at}${counts.length === 0 ? '.' : `: ${counts.join(', ')}.`}`,
  ];
  if (marked.length > 0) {
    out.push('', '| | Where | What the record says |', '|---|---|---|');
    for (const entry of marked) {
      const span = startOf(entry) === endOf(entry) ? `${startOf(entry)}` : `${startOf(entry)}–${endOf(entry)}`;
      out.push(`| ${TITLE[entry.state]} | \`${entry.path}:${span}\` | ${summary(entry).replaceAll('|', '\\|')} |`);
    }
  }
  const silent = (answer.changed ?? []).filter((file) => !file.recorded);
  if (silent.length > 0) {
    const prefix = answer.directory === undefined || answer.directory === '' ? '' : `${answer.directory}/`;
    out.push('', `Changed files the record does not hold: ${silent.map((file) => `\`${prefix}${file.file}\``).join(', ')}.`);
  }
  return `${out.join('\n')}\n`;
}

const PHRASE: Record<Marked['state'], string> = {
  hole: 'holes',
  unentered: 'not entered',
  unwalked: 'unwalked',
  alone: 'entered by one case',
  loaded: 'loaded only',
  walked: 'walked',
};

function countOf(marked: readonly Marked[], state: Marked['state']): number {
  return marked.filter((entry) => entry.state === state).reduce((sum, entry) => sum + entry.parts.length, 0);
}
