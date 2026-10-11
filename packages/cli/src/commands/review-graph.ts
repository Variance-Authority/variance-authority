// compass: variance-authority/runtime/attention
/**
 * The changed code as a diagram for a pull-request comment.
 *
 * A reviewer asks which of the functions this change touched anything proves,
 * and by what. So the diagram draws the changed functions, grouped under the
 * file that holds them and coloured by the reach the table above counts, with
 * an edge from each test file whose cases the record says call into one. A red
 * function with no edge is the finding. The test files are the record's, carried
 * on each region, not recomputed from what moved against the base. Each function
 * says how the edit wrote it and, as the table does, how many of the cases that
 * entered it ran a changed line.
 *
 * A function is its own region: its colour, count and tests are the ones the
 * record gives the function. A branch or closure inside it that no case reached
 * is counted on the function rather than painting it red, because the function
 * did run. When the change reached only a closure, the node is that closure and
 * says so by its name.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { REACHES, type Reach, type Review, type ReviewFile, type ReviewRegion } from './review.js';

/** Past this many functions the worst are drawn and the rest are counted. */
const FUNCTIONS = 24;
/** Past this many test files the ones reaching the most drawn functions are kept. */
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
  readonly own: ReviewRegion;
  /** Branches and closures inside it that no case ran. */
  readonly bare: number;
}

/** The diagram in a fold, or nothing when the change touched no named function. */
export function changeGraph(review: Review): readonly string[] {
  const all = review.files.flatMap(functionsOf);
  if (all.length === 0) return [];
  const drawn = [...all]
    .sort((a, b) => severity(b.own.reach) - severity(a.own.reach) || b.bare - a.bare || codeUnitOrder(a.file, b.file) || a.own.startLine - b.own.startLine)
    .slice(0, FUNCTIONS);
  const reached = new Map<string, number>();
  for (const fn of drawn) for (const test of fn.own.tests) reached.set(test, (reached.get(test) ?? 0) + 1);
  const kept = new Set([...reached.keys()].sort((a, b) => reached.get(b)! - reached.get(a)! || codeUnitOrder(a, b)).slice(0, TESTS));

  const none = all.filter((fn) => CLASS[fn.own.reach] === 'none').length;
  const lines = [
    '',
    `<details><summary>🔀 ${all.length} changed function${all.length === 1 ? '' : 's'}${none > 0 ? `, ${none} with no case` : ''}</summary>`,
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
  for (const file of [...new Set(drawn.map((fn) => fn.file))].sort(codeUnitOrder)) {
    lines.push(`  subgraph ${id('f', file)}["${label(file)}"]`, '    direction LR');
    for (const fn of drawn.filter((held) => held.file === file).sort((a, b) => a.own.startLine - b.own.startLine)) {
      const cases = fn.own.cases === 0 ? 'no case' : `${fn.own.cases} case${fn.own.cases === 1 ? '' : 's'}, ${fn.own.changedLineCases} ran a changed line`;
      const bare = fn.bare === 0 ? '' : ` · ${fn.bare} place${fn.bare === 1 ? '' : 's'} no case ran`;
      lines.push(`    ${id('r', key(fn))}["${MARK[fn.own.reach]} ${label(fn.own.name)} · ${fn.own.edit}<br/>${cases}${bare}"]:::${CLASS[fn.own.reach]}`);
    }
    lines.push('  end');
  }
  // A test file that reaches every drawn function of a file some case reached points at the file, once.
  for (const file of [...new Set(drawn.map((fn) => fn.file))].sort(codeUnitOrder)) {
    const fns = drawn.filter((fn) => fn.file === file && fn.own.tests.length > 0);
    for (const test of kept) {
      const into = fns.filter((fn) => fn.own.tests.includes(test));
      if (into.length > 1 && into.length === fns.length) lines.push(`  ${id('t', test)} --> ${id('f', file)}`);
      else for (const fn of into) lines.push(`  ${id('t', test)} --> ${id('r', key(fn))}`);
    }
  }
  lines.push(
    '  classDef none fill:#ffebe9,stroke:#cf222e,color:#1f2328',
    '  classDef far fill:#fff8c5,stroke:#9a6700,color:#1f2328',
    '  classDef near fill:#dafbe1,stroke:#1a7f37,color:#1f2328',
    '  classDef loaded fill:#f6f8fa,stroke:#8c959f,color:#1f2328',
    '```',
  );
  if (all.length > drawn.length) lines.push('', overflow(all.length - drawn.length, all.length));
  if (reached.size > kept.size) lines.push('', `${reached.size - kept.size} more test file${reached.size - kept.size === 1 ? '' : 's'} not drawn.`);
  lines.push('', '</details>');
  return lines;
}

/**
 * One function per declared name. Its own region, the one named exactly that,
 * speaks for it; when the change reached only a closure, the outermost region
 * under the name does.
 */
function functionsOf(file: ReviewFile): readonly Fn[] {
  const by = new Map<string, ReviewRegion[]>();
  for (const region of file.regions ?? []) {
    if (region.kind === 'module' || region.name === '') continue;
    const name = region.name.split('/')[0]!;
    const held = by.get(name);
    if (held === undefined) by.set(name, [region]);
    else held.push(region);
  }
  return [...by].map(([name, regions]) => {
    const own = regions.find((region) => region.name === name)
      ?? [...regions].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine)[0]!;
    return {
      file: file.file,
      name,
      own,
      bare: regions.filter((region) => region !== own && region.cases === 0 && CLASS[region.reach] === 'none').length,
    };
  });
}

/** The line under a diagram that left functions out; a change this wide is named as such. */
function overflow(left: number, total: number): string {
  return total > 200 ? `${left} more functions not drawn, in a change of ${total}.` : `${left} more functions not drawn.`;
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

/** A label Mermaid and the markdown fence read as text: quotes, markup, backticks and line breaks written as entities. */
function label(text: string): string {
  return text.replace(/["<>`\n\r]/gu, (character) => `#${character.charCodeAt(0)};`);
}
