/**
 * How many probes an execution index costs, counted over real code.
 *
 * [Spec 0028](../../../docs/specs/0028-the-instrument.md) claims the boundary
 * model is *smaller* than statement coverage rather than a rename of it, and that
 * claim is a number or it is nothing. So this instruments every product file in
 * this repository and reports:
 *
 *   the census   — probes by kind, and per file
 *   the ratio    — against Istanbul's three counter maps, counted from the same
 *                  tree by its own rules (statements, functions, branches)
 *   the price    — what expression-position decisions (`?:`, `&&`, `||`, `??`)
 *                  would add, since they are deliberately not taken in v1
 *
 * **The comparator is Istanbul's rule, not Istanbul's output.** The visitor list
 * is transcribed from `istanbul-lib-instrument` — a `VariableDeclarator` is a
 * statement and its `VariableDeclaration` is not, a `FunctionDeclaration` is a
 * function and not a statement, an `if` is one statement and two branches — and
 * applied to an `oxc` tree. It is a ratio between two models, and it does not
 * depend on Babel being installed to be worth having.
 *
 * It also re-parses every instrumented file and fails on the first one that no
 * longer compiles. That is the cheapest broad correctness check available: three
 * hundred files of real TypeScript, against fixtures that only cover what somebody
 * thought to write down.
 *
 * Run:  yarn workspace @variance-authority/oxc census
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { instrument } from '../dist/instrument/index.js';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** Product code: what ships, not what checks it and not what builds it. */
const FILES = execFileSync('git', ['ls-files', 'packages/**/*.ts', 'packages/**/*.tsx'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((file) => !/\.test\.tsx?$/.test(file));

/** `coverStatement` in Istanbul's visitor, node for node. */
const STATEMENTS = new Set([
  'ExpressionStatement',
  'VariableDeclarator',
  'ReturnStatement',
  'ThrowStatement',
  'BreakStatement',
  'ContinueStatement',
  'DebuggerStatement',
  'IfStatement',
  'SwitchStatement',
  'TryStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'LabeledStatement',
  'WithStatement',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
]);

/** `coverFunction`. A method's `value` is a `FunctionExpression`, so it counts once. */
const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const census = new Map();
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

const istanbul = { statements: 0, functions: 0, branches: 0 };
/** What the same constructs would cost this model, as outcome regions. */
let priced = 0;
let blocks = 0;
let skipped = 0;
const broken = [];

const started = process.hrtime.bigint();

for (const file of FILES) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const instrumented = instrument(source, file);

  if (instrumented === undefined) {
    skipped += 1;
    continue;
  }

  blocks += instrumented.blocks.length;
  for (const block of instrumented.blocks) bump(census, block.kind);

  count(parseSync(file, source).program, undefined);

  // The output has to be readable by the same parser, or the probe is a syntax
  // error somebody would meet as a broken test run.
  const again = parseSync(file, instrumented.code);
  if (again.errors.length > 0) broken.push(`${file}: ${again.errors[0]?.message ?? 'unparseable'}`);
}

const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

function count(node, parent) {
  if (node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) count(item, parent);
    return;
  }

  switch (node.type) {
    case undefined:
      break;
    case 'ConditionalExpression':
      istanbul.branches += 2;
      priced += 2;
      break;
    case 'LogicalExpression':
      // A chain is one entry per leaf: `a && b && c` is three, not one.
      istanbul.branches += parent === 'LogicalExpression' ? 1 : 2;
      priced += parent === 'LogicalExpression' ? 1 : 2;
      break;
    case 'AssignmentPattern':
      istanbul.branches += 1;
      priced += 1;
      break;
    case 'SwitchCase':
      istanbul.branches += 1;
      break;
    default:
      if (STATEMENTS.has(node.type)) istanbul.statements += 1;
      if (FUNCTIONS.has(node.type)) istanbul.functions += 1;
      if (node.type === 'IfStatement') istanbul.branches += 2;
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    count(node[key], node.type);
  }
}

const counters = istanbul.statements + istanbul.functions + istanbul.branches;
const files = FILES.length - skipped;
const width = Math.max(...[...census.keys()].map((kind) => kind.length));
const ORDER = ['module', 'function', 'branch', 'continuation', 'resume', 'loop', 'case', 'handler'];

console.log(
  `${FILES.length} product files, ${skipped} unparseable, instrumented and re-parsed in ${elapsed.toFixed(0)} ms\n`,
);

for (const kind of ORDER) {
  const at = census.get(kind) ?? 0;
  const share = ((at / blocks) * 100).toFixed(1);
  console.log(`  ${kind.padEnd(width)}  ${String(at).padStart(6)}  ${share.padStart(5)}%`);
}

console.log(`  ${'TOTAL'.padEnd(width)}  ${String(blocks).padStart(6)}`);
console.log(`\n  ${(blocks / files).toFixed(1)} probes per file\n`);

console.log(`  Istanbul, by its own rules on the same tree:`);
console.log(`    statements  ${String(istanbul.statements).padStart(6)}`);
console.log(`    functions   ${String(istanbul.functions).padStart(6)}`);
console.log(`    branches    ${String(istanbul.branches).padStart(6)}`);
console.log(`    counters    ${String(counters).padStart(6)}\n`);

console.log(`  ${(blocks / istanbul.statements).toFixed(3)}x its statements`);
console.log(`  ${(blocks / counters).toFixed(3)}x every counter it inserts`);
console.log(
  `  expression-position decisions would add ${priced} probes — ${((blocks + priced) / counters).toFixed(3)}x`,
);

if (broken.length > 0) {
  console.log(`\n${broken.length} instrumented files no longer parse:`);
  for (const failure of broken.slice(0, 20)) console.log(`  ${failure}`);
  process.exitCode = 1;
}
