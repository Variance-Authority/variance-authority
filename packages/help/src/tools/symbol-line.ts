/**
 * `symbol --line`: the declarations of a name, ordered by the tests that ran the
 * line.
 *
 * The source index owns which declarations the name has; the recording owns
 * which tests ran the line and which entered each declaration. A declaration
 * the line called is entered by the line's tests and few others, so each is
 * scored by Ochiai — the tests it shares with the line over the geometric mean
 * of both counts — in native code, where the recording is read.
 *
 * A line no test ran, or a name no file of the checkout declares, tells the
 * declarations apart by nothing, so the answer says so and gives `symbol`'s
 * answer without the line.
 */

// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';
import { resonance, type JourneyEnd, type Resonant, type SuiteResonance } from '@variance-authority/sense';
import { stringArg, type Tool, type ToolInvocation } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { FoundNothing } from './find.js';
import { ofSuite } from './grep-ran.js';

const byPlace = (a: JourneyEnd, b: JourneyEnd): number => codeUnitOrder(a.file, b.file) || a.line - b.line;
const tests = (count: number): string => `${count} ${count === 1 ? 'test' : 'tests'}`;

/** `symbol`'s answer for `input`, its declarations ordered by the line `input.line` names. */
export function symbolAtLine(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined, symbol: Tool<Help>): string {
  const root = invocation?.root;
  if (root === undefined) throw new Error('`symbol --line` reads what a checkout recorded, and this host named no checkout to read');
  const name = stringArg(input, 'name');
  const at = lineOf(stringArg(input, 'line'));
  const { line: _, ...rest } = input;
  const declared = declaredFiles(help, rest, invocation, symbol);
  if (declared === undefined) return [`No file in this checkout declares \`${name}\`, so no recording tells its declarations apart:`, '', symbol.run(help, rest, invocation)].join('\n');
  const candidates = [...declared].flatMap(([file, lines]) => lines.map((line) => ({ file, line })));
  const suites = resonance(root, at, name, candidates);
  const told = suites.filter((suite) => suite.resonance.notRecorded == null && suite.resonance.cases > 0);
  const untold = suites.filter((suite) => !told.includes(suite)).map((suite) => untoldLine(suite, at, name, told.length === 0 ? ':' : '.'));
  if (told.length === 0) {
    const why = untold.length > 0 ? untold : [`No recording under ${root} holds a suite, so nothing tells the declarations of \`${name}\` apart:`];
    return [...why, '', symbol.run(help, rest, invocation)].join('\n');
  }
  return [...told.map((suite) => formatSuite(suite, at, name)), ...(untold.length > 0 ? [untold.join('\n')] : [])].join('\n\n');
}

/** The files of this checkout that declare the name, or none when only an installed dependency may. */
function declaredFiles(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined, symbol: Tool<Help>): ReadonlyMap<string, readonly number[]> | undefined {
  try {
    return symbol.files!(help, input, invocation).files;
  } catch (error) {
    if (error instanceof FoundNothing) return undefined;
    throw error;
  }
}

/** `src/page.ts:3`, split on its last colon so a path holding one is kept whole. */
function lineOf(spelled: string): { readonly file: string; readonly line: number } {
  const colon = spelled.lastIndexOf(':');
  const line = Number(spelled.slice(colon + 1));
  if (colon <= 0 || !Number.isInteger(line) || line < 1) throw new Error(`\`--line\` takes \`<file>:<line>\`, such as \`src/page.ts:3\`, not \`${spelled}\``);
  return { file: spelled.slice(0, colon), line };
}

/** Why a suite tells the declarations apart by nothing, ending in `end`: a colon when `symbol`'s answer follows. */
function untoldLine({ suite, resonance }: SuiteResonance, at: { file: string; line: number }, name: string, end: string): string {
  const why = resonance.notRecorded == null ? `No recorded test ran ${at.file}:${at.line}` : `The recording cannot place ${at.file}:${at.line}: ${resonance.notRecorded}`;
  return `${ofSuite(suite)}${why}, so nothing tells the declarations of \`${name}\` apart${end}`;
}

function formatSuite({ suite, resonance, since }: SuiteResonance, at: { file: string; line: number }, name: string): string {
  const lines = [`${ofSuite(suite)}\`${name}\` at ${at.file}:${at.line}, by the ${resonance.cases} recorded ${resonance.cases === 1 ? 'test' : 'tests'} that ran the line:`];
  const scored = resonance.resonant.filter((row) => row.shared > 0);
  const apart = resonance.resonant.filter((row) => row.recorded && row.shared === 0).sort(byPlace);
  const unrecorded = resonance.resonant.filter((row) => !row.recorded).sort(byPlace);
  const tied = (row: Resonant): boolean => scored.some((other) => other !== row && Math.abs(other.score - row.score) < 1e-9);
  lines.push('', ...(scored.length > 0
    ? scored.map((row) => `${row.file}:${row.line}  ${row.score.toFixed(2)}${tied(row) ? ' tied' : ''}  ${row.shared} of the ${tests(row.cases)} that entered it ran the line`)
    : [`No test that ran the line entered a declaration of \`${name}\`.`]));
  if (apart.length > 0) lines.push('', 'Not run with it:', ...apart.map((row) => `${row.file}:${row.line}  ${row.cases === 0 ? 'no recorded test entered it' : `none of the ${tests(row.cases)} that entered it ran the line`}`));
  if (unrecorded.length > 0) lines.push('', 'Not in the recording:', ...unrecorded.map((row) => `${row.file}:${row.line}  no recorded function is written at this line`));
  if (since.length > 0) lines.push('', 'Written since the recording ran:', ...[...since].sort(byPlace).map((end) => `${end.file}:${end.line}`));
  return lines.join('\n');
}
