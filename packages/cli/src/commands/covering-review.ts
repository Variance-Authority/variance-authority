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

/** One region a review draws, on a path named from the repository's top. */
interface Marked {
  readonly path: string;
  readonly region: StatedRegion;
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
  const marked: Marked[] = [];
  for (const file of answer.changed ?? []) {
    for (const region of file.regions) {
      const state = region.state ?? (region.tests.length === 0 ? 'unentered' : 'walked');
      if (state === 'walked') continue;
      marked.push({ path: `${prefix}${file.file}`, region, state });
    }
  }
  return marked.sort((left, right) => RANK[left.state] - RANK[right.state]);
}

/** The sentence a reviewer reads beside the region. */
function summary({ region, state }: Marked): string {
  const what = `${region.kind} ${region.name}`;
  const stopped = region.stopped ?? [];
  switch (state) {
    case 'hole':
      return `No case entered ${what}, and ${stopped.length === 1 ? 'a case' : `${stopped.length} cases`} ` +
        `that could have reached it stopped first: ${stopped.map((test) => test.name).join(', ')}.`;
    case 'unwalked':
      return `No case entered ${what}, and every case that could have reached it finished.`;
    case 'unentered':
      return `No case entered ${what}.`;
    case 'alone':
      return `One case entered ${what}: ${region.tests.map((test) => `${test.name} (${test.file})`).join(', ')}.`;
    case 'loaded':
      return `${what} ran only while its module loaded; no case called into it.`;
    default:
      return `${what} was entered by ${region.tests.length} cases.`;
  }
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
    `line=${marked.region.startLine}`,
    `endLine=${marked.region.endLine}`,
    `title=${property(`${TITLE[marked.state]}: ${marked.region.name}`)}`,
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
    external_id: `${marked.path}:${marked.region.startLine}:${marked.region.name}`,
    annotation_type: 'CODE_SMELL',
    path: marked.path,
    line: marked.region.startLine,
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
  const count = (state: Marked['state']): number => marked.filter((entry) => entry.state === state).length;
  const drawn = Math.min(marked.length, BITBUCKET_KEPT);
  const silent = (answer.changed ?? []).filter((file) => !file.recorded).length;
  return {
    title: 'What the suite walked',
    details: `${regions.length} changed region${regions.length === 1 ? '' : 's'}${
      answer.since === undefined ? '' : ` since ${answer.since}`
    }. ${drawn === marked.length
      ? `${marked.length} annotated`
      : `${drawn} of ${marked.length} annotated, holes first; Bitbucket keeps no more on one report`}.`,
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
