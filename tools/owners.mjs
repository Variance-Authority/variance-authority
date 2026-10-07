#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';

/**
 * Answers this repository already owns, computed again somewhere else.
 *
 * ADR-0069 says computing an owned answer yourself is a defect, and the ADR was
 * not enough: the same three idioms kept being written again, one file at a
 * time, each a few lines long. A copy-paste detector does not see them, because
 * nobody copied anything. Each one was typed fresh, with different names around
 * the same five tokens. So this reads the parse tree for the shape of each idiom
 * and names the owner.
 *
 * A ratchet, like `documented.mjs`. What is here today is recorded per file, a
 * new site fails, and a site that moved to its owner tightens the baseline.
 *
 * `yarn owners` prints the list; `--write` records it.
 * `tools/owners.check.ts` compares the two.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'tools/owners.baseline.json');

/**
 * Each idiom, where its answer lives, and the files that are that answer.
 *
 * Atomic writing has no owner across packages. The message says so and names
 * the writer the same package already has, which is the nearest thing to one.
 */
export const IDIOMS = {
  digest: {
    owner:
      '`digestString` / `digestBytes` from `@variance-authority/core/format`; inside `sense`, `./digest.js`, ' +
      'which takes the same digests from `node:crypto`',
    owns: ['packages/sense/src/digest.ts'],
  },
  'code-unit-order': {
    owner:
      '`codeUnitOrder` from `@variance-authority/core/segment` for strings; for numbers, subtract',
    owns: ['packages/core/src/segment/index.ts'],
  },
  'atomic-write': {
    owner: 'no shared owner yet; call the writer this package already has',
    owns: [],
  },
};

/**
 * Production sources: what ships, and the tools that write what ships.
 *
 * Tests are left out because a test is where the platform's answer is the
 * oracle: `sha256.test.ts` calls `createHash` to check the portable digest
 * against, and routing that through the owner would make the check agree with
 * itself.
 */
export function sources() {
  return execFileSync(
    'git',
    // Without `:(glob)`, `*` crosses directories: these reach every depth.
    ['ls-files', '--', 'packages/*/src/*.ts', 'packages/*/src/*.tsx', 'packages/*/src/*.mts', 'packages/*/src/*.cts',
      'tools/*.mjs', 'tools/*.ts'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => file !== '' && !isTest(file) && !file.endsWith('.d.ts'))
    .filter((file) => existsSync(join(ROOT, file)));
}

const isTest = (file) =>
  /\.(test|spec|check|measure)\.[cm]?tsx?$/.test(file) || /(^|\/)(__tests__|__fixtures__|fixtures|test)\//.test(file);

/** Every site of every idiom in one file's text, outside the files that own it. */
export function sitesIn(file, text) {
  const parsed = parseSync(file, text);
  if (parsed.errors.length > 0) {
    throw new Error(`${file}: ${parsed.errors[0].message}`);
  }
  const lineOf = lines(text);
  const sites = [];
  const found = (idiom, node, name) => {
    if (IDIOMS[idiom].owns.includes(file)) return;
    sites.push({ idiom, at: file, line: lineOf(node.start), name });
  };

  visit(parsed.program, (node, scope) => {
    if (node.type === 'CallExpression' && isHashCall(node)) found('digest', node, scope.name);
    if (node.type === 'ConditionalExpression' && isCodeUnitOrder(node)) found('code-unit-order', node, scope.name);
    if (isFunction(node) && writesThenRenames(node)) found('atomic-write', node, nameOf(node, scope));
  });

  return sites;
}

/** Every site in the repository, in code-unit order of file and line. */
export function sites() {
  return sources().flatMap((file) => sitesIn(file, readFileSync(join(ROOT, file), 'utf8')));
}

/** One row per idiom per file: what the baseline records. */
export function counted(found) {
  const rows = new Map();
  for (const site of found) {
    const key = `${site.idiom} ${site.at}`;
    const row = rows.get(key) ?? { idiom: site.idiom, at: site.at, count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

// `createHash('sha256')`, `crypto.createHash('sha256')`,
// `crypto.subtle.digest('SHA-256', …)`. The owner computes SHA-256 only, so a
// SHA-1 Jest cache key or an MD5 S3 ETag is a different answer, not a copy.
function isHashCall(call) {
  const callee = call.callee;
  const algorithm = algorithmOf(call.arguments[0]);
  if (callee.type === 'Identifier') return callee.name === 'createHash' && algorithm === 'sha256';
  if (callee.type !== 'MemberExpression' || callee.computed) return false;
  if (callee.property.name === 'createHash') return algorithm === 'sha256';
  return (
    callee.property.name === 'digest' &&
    callee.object.type === 'MemberExpression' &&
    !callee.object.computed &&
    callee.object.property.name === 'subtle' &&
    algorithm === 'sha256'
  );
}

// `'sha256'`, `'SHA-256'` or `{ name: 'SHA-256' }`, folded to one spelling.
function algorithmOf(node) {
  if (node === undefined) return undefined;
  if (node.type === 'ObjectExpression') {
    const name = node.properties.find((property) => property.key?.name === 'name');
    return name === undefined ? undefined : algorithmOf(name.value);
  }
  if (node.type !== 'Literal' || typeof node.value !== 'string') return undefined;
  return node.value.toLowerCase().replace('-', '');
}

// `a < b ? -1 : a > b ? 1 : 0`, in either nesting and with either sign first.
function isCodeUnitOrder(node) {
  if (!isRelational(bare(node.test))) return false;
  const alternate = bare(node.alternate);
  const inner = alternate.type === 'ConditionalExpression' ? alternate : bare(node.consequent);
  if (inner.type !== 'ConditionalExpression' || !isRelational(bare(inner.test))) return false;
  const outer = inner === alternate ? node.consequent : node.alternate;
  const leaves = [outer, inner.consequent, inner.alternate].map((leaf) => unitValue(bare(leaf)));
  return leaves.includes(-1) && leaves.includes(0) && leaves.includes(1);
}

const bare = (node) => (node.type === 'ParenthesizedExpression' ? bare(node.expression) : node);

const isRelational = (node) =>
  node.type === 'BinaryExpression' && ['<', '>', '<=', '>='].includes(node.operator);

function unitValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal') {
    return -node.argument.value;
  }
  return undefined;
}

// A function that itself calls a file write and a rename: temporary file, then
// move into place. Calls inside a nested function belong to that function.
function writesThenRenames(fn) {
  const called = new Set();
  visit(fn.body, (node) => {
    if (node.type === 'CallExpression') called.add(calleeName(node.callee));
  }, { into: (node) => !isFunction(node) });
  const writes = called.has('writeFile') || called.has('writeFileSync');
  const renames = called.has('rename') || called.has('renameSync');
  return writes && renames;
}

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) return callee.property.name;
  return undefined;
}

const isFunction = (node) =>
  node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';

function nameOf(fn, scope) {
  return fn.id?.name ?? scope.binding ?? scope.name;
}

/**
 * Depth-first over every node, carrying the nearest named function so a site
 * can say where it is. `into` decides whether to descend below a node.
 */
function visit(root, enter, { into = () => true } = {}) {
  const walk = (node, scope) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, scope);
      return;
    }
    if (typeof node.type !== 'string') return;
    let inner = scope;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      inner = { ...scope, binding: node.id.name };
    } else if (node.type === 'MethodDefinition' || node.type === 'Property') {
      inner = { ...scope, binding: node.key?.name };
    }
    enter(node, inner);
    if (isFunction(node)) inner = { name: nameOf(node, inner), binding: undefined };
    if (node !== root && !into(node)) return;
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      walk(node[key], inner);
    }
  };
  walk(root, { name: undefined, binding: undefined });
}

// oxc reports UTF-16 offsets into the text it was given.
function lines(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = sites();
  if (process.argv.includes('--write')) {
    const rows = counted(found);
    writeFileSync(BASELINE, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    process.stdout.write(`owners: ${found.length} sites in ${rows.length} rows, recorded\n`);
  } else {
    for (const site of found) {
      process.stdout.write(`${site.at}:${site.line}  ${site.idiom}  ${site.name ?? ''}\n`);
    }
  }
}
