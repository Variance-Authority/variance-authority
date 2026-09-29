// compass: variance-authority/runtime/attention
/**
 * The changed code as a diagram for a pull-request comment.
 *
 * A reviewer opening the comment asks which of the functions this change
 * touched anything proves, and by what. So the diagram draws the changed
 * functions themselves, grouped under the file that holds them and coloured by
 * the same reach the table above counts, and draws an edge from a test file to
 * a function only where the two records say a case in that file now calls into
 * it. A red function with no edge into it is the finding. Names are the
 * declared names in the diff, not directories, and a function whose cases are
 * counted but not named still appears, with its count.
 */

import type { RegionMotion } from '@variance-authority/sense/test-selection';
import { REACHES, type Reach, type Review, type ReviewFile, type ReviewRegion } from './review.js';

/** Past this many functions the worst are drawn and the rest are counted. */
const FUNCTIONS = 24;
/** Past this many test files the ones covering the most drawn functions are kept. */
const TESTS = 8;

const MARK: Readonly<Record<Reach, string>> = {
  near: '🟢',
  far: '🟡',
  unplaced: '🟠',
  loaded: '⚪',
  hole: '🔴',
  unwalked: '🔴',
  unknown: '🔴',
};

const CLASS: Readonly<Record<Reach, string>> = {
  near: 'near',
  far: 'far',
  unplaced: 'far',
  loaded: 'loaded',
  hole: 'none',
  unwalked: 'none',
  unknown: 'none',
};

interface Fn {
  readonly file: string;
  readonly name: string;
  readonly reach: Reach;
  readonly cases: number;
  readonly written: boolean;
  readonly startLine: number;
  readonly endLine: number;
}

/** The diagram, or nothing when the change touched no named function. */
export function changeGraph(review: Review): readonly string[] {
  const all = functionsOf(review.files);
  if (all.length === 0) return [];
  const drawn = [...all]
    .sort((a, b) => severity(b.reach) - severity(a.reach) || Number(b.written) - Number(a.written) || order(a.file, b.file) || a.startLine - b.startLine)
    .slice(0, FUNCTIONS);
  const covering = coveringTests(review.motion?.moved?.regions ?? [], drawn);
  const tests = [...new Set([...covering.values()].flat())];
  const counted = new Map(tests.map((test) => [test, [...covering.values()].filter((held) => held.includes(test)).length]));
  const kept = new Set([...tests].sort((a, b) => counted.get(b)! - counted.get(a)! || order(a, b)).slice(0, TESTS));

  const bare = all.filter((fn) => CLASS[fn.reach] === 'none').length;
  const lines = [
    '',
    `<details><summary>🔀 ${all.length} changed function${all.length === 1 ? '' : 's'}${bare > 0 ? `, ${bare} with no case` : ''}</summary>`,
    '',
    'Arrow: a test file whose cases now call into the function.',
    '',
    '```mermaid',
    'flowchart LR',
  ];
  const ids = new Map<string, string>();
  const id = (prefix: string, name: string) => {
    const key = `${prefix}\0${name}`;
    let held = ids.get(key);
    if (held === undefined) ids.set(key, (held = `${prefix}${ids.size}`));
    return held;
  };
  for (const test of kept) lines.push(`  ${id('t', test)}(["${label(basename(test))}"])`);
  const files = [...new Set(drawn.map((fn) => fn.file))].sort(order);
  for (const file of files) {
    lines.push(`  subgraph ${id('f', file)}["${label(file)}"]`);
    for (const fn of drawn.filter((held) => held.file === file).sort((a, b) => a.startLine - b.startLine)) {
      const cases = fn.cases === 0 ? 'no case' : `${fn.cases} case${fn.cases === 1 ? '' : 's'}`;
      lines.push(`    ${id('r', key(fn))}["${MARK[fn.reach]} ${label(fn.name)}${fn.written ? ' · new' : ''}<br/>${cases}"]:::${CLASS[fn.reach]}`);
    }
    lines.push('  end');
  }
  for (const fn of drawn) {
    for (const test of covering.get(key(fn)) ?? []) if (kept.has(test)) lines.push(`  ${id('t', test)} --> ${id('r', key(fn))}`);
  }
  lines.push(
    '  classDef none fill:#ffebe9,stroke:#cf222e,color:#1f2328',
    '  classDef far fill:#fff8c5,stroke:#9a6700,color:#1f2328',
    '  classDef near fill:#dafbe1,stroke:#1a7f37,color:#1f2328',
    '  classDef loaded fill:#f6f8fa,stroke:#8c959f,color:#1f2328',
    '```',
  );
  if (all.length > drawn.length) lines.push('', `${all.length - drawn.length} better-covered functions not drawn.`);
  lines.push('', '</details>');
  return lines;
}

/** One function per file and declared name, at its worst reach: a nested closure belongs to the function it sits in. */
function functionsOf(files: readonly ReviewFile[]): readonly Fn[] {
  const held = new Map<string, Fn>();
  for (const file of files) {
    for (const region of file.regions ?? []) {
      const fn = fnOf(file.file, region);
      if (fn === undefined) continue;
      const seen = held.get(key(fn));
      if (seen === undefined || severity(fn.reach) > severity(seen.reach)) held.set(key(fn), fn);
      else if (fn.written && !seen.written) held.set(key(fn), { ...seen, written: true });
    }
  }
  return [...held.values()];
}

function fnOf(file: string, region: ReviewRegion): Fn | undefined {
  if (region.kind === 'module' || region.name === '') return undefined;
  return {
    file,
    name: region.name.split('/')[0]!,
    reach: region.reach,
    cases: region.cases,
    written: region.written,
    startLine: region.startLine,
    endLine: region.endLine,
  };
}

/** The test files that now call into each drawn function, from the regions whose cases moved. */
function coveringTests(moved: readonly RegionMotion[], drawn: readonly Fn[]): ReadonlyMap<string, readonly string[]> {
  const by = new Map<string, Set<string>>();
  for (const region of moved) {
    const fn = drawn.find((held) => held.file === region.file && held.startLine <= region.endLine && region.startLine <= held.endLine);
    if (fn === undefined) continue;
    const tests = by.get(key(fn)) ?? new Set<string>();
    for (const test of region.now) tests.add(test.file);
    by.set(key(fn), tests);
  }
  return new Map([...by].map(([at, tests]) => [at, [...tests].sort(order)]));
}

function key(fn: Fn): string {
  return `${fn.file}\0${fn.name}`;
}

/** How bad a reach is: a case-less region outranks a far one, which outranks a near one. */
function severity(reach: Reach): number {
  return REACHES.indexOf(reach);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A label Mermaid reads as text: its quote and its markup characters written as entities. */
function label(text: string): string {
  return text.replace(/["<>]/gu, (character) => `#${character.charCodeAt(0)};`);
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
