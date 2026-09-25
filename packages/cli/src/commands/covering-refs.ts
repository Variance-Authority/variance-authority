/**
 * The answer to `variance covering` with every case named once.
 *
 * The text answer prints a case under each range it walked, and a module whose
 * cases all walk its top level prints the whole list under every range. That
 * is how a person scans a file; an agent pays for each repetition in tokens.
 * So this numbers the cases once, in a table at the end, and every range names
 * its cases by those numbers, runs collapsed: `1-11` for eleven cases, `3*`
 * for a case that was inside only while the module evaluated.
 */

import type { CoveringTest, ExecutionTest } from '@variance-authority/sense/test-selection';
import type { CoveringRange } from './covering-frame.js';
import { motionText } from './covering-motion.js';
import { narrowedText, scopeText, staleText } from './covering-text.js';
import type { Covering, StatedRegion } from './covering.js';

type Case = Pick<ExecutionTest, 'id' | 'file' | 'name'>;

/** Say the answer with every case numbered once. */
export function formatCoveringRefs(answer: Covering): string {
  const table = new Table(everyCase(answer));
  const body = answer.frame === 'stale' ? [staleText(answer)] : bodyOf(answer, table);
  // Numbered before the table is read, which is when it knows every case it holds.
  const motion = motionText(answer.motion, (tests) => table.refs(tests));
  return `${[
    ...scopeText(answer),
    ...body,
    ...narrowedText(answer),
    ...table.lines(),
    ...motion,
  ].join('\n')}\n`;
}

function bodyOf(answer: Covering, table: Table): readonly string[] {
  if (answer.changed !== undefined) {
    const lines = [`${answer.changed.length} changed file${answer.changed.length === 1 ? '' : 's'}${
      answer.since === undefined ? '' : ` since ${answer.since}`
    }, read from ${answer.from}${answer.at === undefined ? '' : ` at ${answer.at.slice(0, 12)}`}`];
    for (const file of answer.changed) {
      lines.push(file.file);
      if (file.cases.length > 0) lines.push(`  declares ${table.refs(file.cases)}`);
      if (!file.recorded) {
        if (file.cases.length === 0) lines.push('  no row: the recorded run never loaded it');
        continue;
      }
      if (file.regions.length === 0) lines.push('  no recorded region changed');
      for (const region of file.regions) lines.push(`  ${regionLine(region, table)}`);
    }
    return lines;
  }
  if (answer.ranges !== undefined) {
    return [
      `${answer.file} — ${answer.ranges.length} recorded range${answer.ranges.length === 1 ? '' : 's'}${
        answer.frame === 'mapped' ? ', placed in the text as it is now' : ''
      }`,
      ...answer.ranges.map((range) => rangeLine(range, table)),
    ];
  }
  const target = answer.target ?? { function: '' };
  const where = 'line' in target ? `line ${target.line}` : `function ${target.function}`;
  return [`${answer.file} ${where}${answer.state === undefined ? '' : ` ${answer.state}`}: ${
    witnesses(answer.tests ?? [], answer.stopped, table)
  }`];
}

function rangeLine(range: CoveringRange, table: Table): string {
  const lines = range.startLine === range.endLine ? `${range.startLine}` : `${range.startLine}-${range.endLine}`;
  return `${lines}${range.state === undefined ? '' : ` ${range.state}`}${range.moved === true ? ' edited' : ''}: ${
    witnesses(range.tests, range.stopped, table)
  }`;
}

function regionLine(region: StatedRegion, table: Table): string {
  const carried = region.passengers === undefined
    ? '; ran while its module evaluated, loaders unnamed'
    : region.passengers.length === 0 ? '' : `; carried ${table.refs(region.passengers)}`;
  return `${region.startLine}-${region.endLine} ${region.kind}${region.name === '' ? '' : ` ${region.name}`}${
    region.state === undefined ? '' : ` ${region.state}`
  }: ${witnesses(region.tests, region.stopped, table)}${carried}`;
}

/** The cases that entered, or why none did: a hole names the cases that stopped. */
function witnesses(tests: readonly CoveringTest[], stopped: readonly ExecutionTest[] | undefined, table: Table): string {
  if (stopped === undefined || stopped.length === 0) {
    if (tests.length > 0) return table.refs(tests);
    return stopped === undefined ? 'none' : 'none, and every case that could have reached it finished';
  }
  return `${tests.length === 0 ? 'none' : table.refs(tests)}; stopped first ${table.refs(stopped)}`;
}

/** Every case the answer names, wherever it names it. */
function everyCase(answer: Covering): readonly Case[] {
  const cases: Case[] = [...answer.tests ?? [], ...answer.stopped ?? []];
  for (const range of answer.ranges ?? []) cases.push(...range.tests, ...range.stopped ?? []);
  for (const file of answer.changed ?? []) {
    cases.push(...file.cases);
    for (const region of file.regions) cases.push(...region.tests, ...region.stopped ?? [], ...region.passengers ?? []);
  }
  for (const region of answer.motion?.moved?.regions ?? []) cases.push(...region.before, ...region.now, ...region.stopped ?? []);
  return cases;
}

/** The cases numbered by file and then name, so one file's cases are one run of numbers. */
class Table {
  private readonly number = new Map<string, number>();
  private readonly cases: readonly Case[];
  private starred = false;

  constructor(named: readonly Case[]) {
    const unique = new Map<string, Case>();
    for (const test of named) if (!unique.has(test.id)) unique.set(test.id, test);
    this.cases = [...unique.values()].sort((left, right) =>
      order(left.file, right.file) || order(left.name, right.name) || order(left.id, right.id),
    );
    this.cases.forEach((test, at) => this.number.set(test.id, at + 1));
  }

  /** These cases by number, runs collapsed; `*` marks one inside only while the module evaluated. */
  refs(tests: readonly (Case & { readonly loaded?: boolean })[]): string {
    const called = new Set<number>();
    const loaded = new Set<number>();
    for (const test of tests) (test.loaded === true ? loaded : called).add(this.number.get(test.id)!);
    if (loaded.size > 0) this.starred = true;
    return [...runs([...called]), ...[...loaded].sort((left, right) => left - right).map((at) => `${at}*`)].join(',');
  }

  /** The table, each file once and each case under it once; read after every `refs`. */
  lines(): readonly string[] {
    if (this.cases.length === 0) return [];
    const lines = ['', `cases${this.starred ? ' (* inside only while the module evaluated)' : ''}`];
    let file: string | undefined;
    for (const test of this.cases) {
      if (test.file !== file) lines.push((file = test.file));
      lines.push(`  ${this.number.get(test.id)} ${
        test.id === `${test.file} > ${test.name}` ? test.name : `${test.name} [${test.id}]`
      }`);
    }
    return lines;
  }
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runs(numbers: readonly number[]): readonly string[] {
  const sorted = [...numbers].sort((left, right) => left - right);
  const out: string[] = [];
  for (let at = 0; at < sorted.length;) {
    let end = at;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end += 1;
    out.push(end === at ? `${sorted[at]}` : `${sorted[at]}-${sorted[end]}`);
    at = end + 1;
  }
  return out;
}
