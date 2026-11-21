#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { parseSync } from 'oxc-parser';
import { calleeName, isFunction, lines as lineAt, ROOT, visit } from './owners.mjs';

/**
 * Where a list with one entry per file of the checkout could reach the JS heap.
 *
 * A checkout of 400k files is 400k strings in V8 before anything is done with
 * them, and the operation that asked usually wanted ten rows. Such a list is
 * forbidden: it stays in Rust, and JS receives an answer bounded by the
 * question — a top-N, a page with a limit, a count, one file, or a set the
 * caller scoped by name.
 *
 * A napi export and TypeScript in `packages/*\/src` are the two places that
 * can break it. TypeScript is read on oxc's parse tree: a git listing in any
 * string, a glob, a recursive `readdir`, a function or method that reads a
 * directory and calls itself, and the loop, spread or call that drains a list
 * the addon answers whole or a page at a time. Each is allowed when a `bound:`
 * line above it says what bounds it.
 *
 * What was unbounded when the rule came in is recorded in the baseline, which
 * only shrinks. `yarn repo-sized` prints what is unbounded; `--write` records it.
 */

export const BASELINE = join(ROOT, 'tools/repo-sized.baseline.json');

const NATIVE = join(ROOT, 'packages/sense/native/src');
const PACKAGES = join(ROOT, 'packages');

const COLLECTION = /\b(?:Vec|VecDeque|HashMap|HashSet|BTreeMap|BTreeSet|IndexMap|IndexSet)\s*</u;
const TYPED_ARRAY = /\b(?:Uint8Array|Uint16Array|Uint32Array|Int32Array|Float64Array|BigUint64Array)\b/u;

function filesUnder(directory, keep) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(keep)
    .sort(codeUnitOrder);
}

/**
 * The `bound:` line in the comment block that ends right above `line`, if
 * there is one: `/// bound: …` in Rust, `// bound: …` in TypeScript. A bound
 * names the limit, never the hope: "at most `limit` rows", "the files the
 * asker named", "the chain's segments". "Small in practice" is the reason
 * this file exists.
 */
function boundAbove(lines, line, comment) {
  for (let at = line - 1; at >= 0; at -= 1) {
    const text = lines[at].trim();
    if (text.startsWith('#[') || text === '') continue;
    if (!text.startsWith(comment) && !text.startsWith('*') && !text.startsWith('/*')) return undefined;
    const said = /\bbound:\s*(\S.*)$/u.exec(text);
    if (said) return said[1];
  }
  return undefined;
}

/** `#[napi(object)]` structs by name, with the text of their fields. */
function objectsIn(texts) {
  const objects = new Map();
  for (const text of texts) {
    for (const found of text.matchAll(/#\[napi\(object[^\]]*\)\]\s*(?:#\[[^\]]*\]\s*)*pub struct (\w+)(?:<[^>]*>)?\s*\{([\s\S]*?)\n\}/gu)) {
      objects.set(found[1], found[2]);
    }
  }
  return objects;
}

/** Whether `type` is or holds a collection, following `#[napi(object)]` structs it names. */
function holdsCollection(type, objects, seen = new Set()) {
  if (COLLECTION.test(type) || TYPED_ARRAY.test(type)) return true;
  for (const [name] of type.matchAll(/\b[A-Z]\w*/gu)) {
    if (seen.has(name) || !objects.has(name)) continue;
    seen.add(name);
    if (holdsCollection(objects.get(name), objects, seen)) return true;
  }
  return false;
}

/**
 * Every napi export (`#[napi]` in `packages/sense/native/src`) that takes or
 * returns a collection — `Vec`, a map or set, a typed array, or a
 * `#[napi(object)]` holding one — with its bound when it says one.
 */
export function nativeCrossings() {
  const files = filesUnder(NATIVE, (file) => file.endsWith('.rs') && !file.endsWith('_tests.rs'));
  const texts = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  const objects = objectsIn(texts.values());
  const found = [];
  for (const [file, text] of texts) {
    const lines = text.split('\n');
    let owner = '';
    for (let line = 0; line < lines.length; line += 1) {
      const impl = /^impl(?:<[^>]*>)?\s+(\w+)/u.exec(lines[line]);
      if (impl) owner = impl[1];
      if (/^(?:pub )?fn /u.test(lines[line]) || lines[line].startsWith('}')) owner = lines[line].startsWith('}') ? '' : owner;
      if (!/^\s*#\[napi(?:\]|\((?!object|constructor)[^)]*\)\])/u.test(lines[line])) continue;
      let at = line + 1;
      while (at < lines.length && /^\s*(?:#\[|\/\/)/u.test(lines[at])) at += 1;
      if (!/^\s*pub (?:async )?fn /u.test(lines[at])) continue;
      let signature = '';
      for (let end = at; end < lines.length; end += 1) {
        signature += `${lines[end]}\n`;
        if (/\{\s*$|;\s*$/u.test(lines[end])) break;
      }
      const name = /fn (\w+)/u.exec(signature)[1];
      const [, args = '', returns = ''] = /\(([\s\S]*)\)\s*(?:->\s*([\s\S]*?))?\s*(?:where[\s\S]*)?\{?\s*$/u.exec(signature) ?? [];
      const js = /js_name\s*=\s*"(\w+)"/u.exec(lines[line])?.[1] ?? name.replace(/_(\w)/gu, (_, letter) => letter.toUpperCase());
      const crosses = [holdsCollection(args, objects) && 'takes', holdsCollection(returns, objects) && 'returns'].filter(Boolean);
      if (crosses.length === 0) continue;
      found.push({
        at: `${relative(ROOT, file)} ${owner === '' ? '' : `${owner}.`}${name}`,
        line: line + 1,
        crosses: crosses.join(' and '),
        bound: boundAbove(lines, line, '//'),
        js,
        whole: owner !== '' && args.trim() === '&self' && crosses.includes('returns'),
        paged: owner !== '' && args.trim() !== '&self' && crosses.includes('returns'),
      });
    }
  }
  return found;
}

/** A git command that lists every file, written in any string: quoted either way or in a template. */
const GIT_LISTING = /\bls-(?:files|tree)\b/u;

/** Calls that list files by pattern. */
const GLOBS = new Set(['globSync', 'glob', 'fg', 'fastGlob']);

const READS_DIRECTORY = new Set(['readdir', 'readdirSync', 'opendir', 'opendirSync']);

/** Iterator names every Map, Set and array has, which no native list is told apart from. */
const BUILT_IN = new Set(['entries', 'keys', 'values']);

/** The identifiers a `for` loop's update advances: `at += PAGE`, `at++`, `at = at + PAGE`. */
function advanced(update) {
  if (update === null || update === undefined) return [];
  if (update.type === 'SequenceExpression') return update.expressions.flatMap(advanced);
  if (update.type === 'UpdateExpression' && update.argument.type === 'Identifier') return [update.argument.name];
  if (update.type === 'AssignmentExpression' && update.left.type === 'Identifier') return [update.left.name];
  return [];
}

/**
 * Every place one file lists files itself (`lists`), walks a directory by
 * calling itself (`walks`), or drains a list the addon answers whole or a page
 * at a time (`drains`), each placed in its nearest named function.
 */
export function listingsIn(file, text, whole, paged = new Set()) {
  const parsed = parseSync(file, text);
  if (parsed.errors.length > 0) throw new Error(`${file}: ${parsed.errors[0].message}`);
  const lineOf = lineAt(text);
  const source = text.split('\n');
  const found = [];
  const report = (node, crosses, scope, statement = scope.statement) => {
    const line = lineOf(node.start);
    // The bound is said above the statement holding the node, or on its line.
    const bound =
      boundAbove(source, lineOf(statement) - 1, '//') ??
      boundAbove(source, line - 1, '//') ??
      /\/\/ bound:\s*(\S.*)$/u.exec(source[line - 1])?.[1];
    found.push({ at: `${relative(ROOT, file)} ${scope.name ?? '(top level)'}`, line, crosses, bound });
  };
  // Asking for the whole list lands it in the heap, however it is used after.
  const drainsWhole = (node) =>
    node.type === 'CallExpression' &&
    node.arguments.length === 0 &&
    node.callee.type === 'MemberExpression' &&
    whole.has(calleeName(node.callee));
  // What each function does: a callback nested in one reads and recurses on its behalf too.
  const owns = new Map();
  visit(parsed.program, (node, scope) => {
    if (isFunction(node)) {
      owns.set(node, { self: node.id?.name ?? scope.binding, reads: undefined, recurses: false, outer: owns.get(scope.fn), scope });
      return;
    }
    if ((node.type === 'Literal' && typeof node.value === 'string' && GIT_LISTING.test(node.value)) ||
        (node.type === 'TemplateLiteral' && node.quasis.some((quasi) => GIT_LISTING.test(quasi.value.cooked ?? quasi.value.raw)))) {
      report(node, 'lists', scope);
    }
    if (node.type === 'CallExpression') {
      const called = calleeName(node.callee);
      const fastGlob = node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'fg';
      const recursive = READS_DIRECTORY.has(called) && node.arguments.some((argument) =>
        argument.type === 'ObjectExpression' &&
        argument.properties.some((property) => property.key?.name === 'recursive' && property.value?.value === true));
      if ((node.callee.type === 'Identifier' && GLOBS.has(called)) || fastGlob || recursive) report(node, 'lists', scope);
      // A function calls itself by its name, or as `this.name` from a method.
      const selfCall = node.callee.type === 'Identifier' || node.callee.object?.type === 'ThisExpression';
      for (let own = owns.get(scope.fn); own !== undefined; own = own.outer) {
        if (READS_DIRECTORY.has(called) && own.reads === undefined) own.reads = node;
        if (selfCall && own.self !== undefined && called === own.self) own.recurses = true;
      }
      if (drainsWhole(node)) report(node, 'drains', scope);
    }
    if (node.type === 'ForStatement') {
      const page = pageIn(node.body, advanced(node.update), paged);
      if (page !== undefined) report(page, 'drains', scope);
    }
  });
  for (const [fn, own] of owns) {
    if (own.reads === undefined || !own.recurses) continue;
    const scope = { name: fn.id?.name ?? own.scope.binding ?? own.scope.name };
    report(own.reads, 'walks', scope, own.reads.start);
  }
  return found;
}

/** The first call in a loop's body handing a `paged` native method a counter the loop advances. */
function pageIn(body, counters, paged) {
  if (counters.length === 0) return undefined;
  let page;
  visit(body, (node) => {
    if (page === undefined && node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && paged.has(calleeName(node.callee)) &&
        node.arguments.some((argument) => argument.type === 'Identifier' && counters.includes(argument.name))) {
      page = node;
    }
  }, { into: (node) => !isFunction(node) });
  return page;
}

/**
 * Every place TypeScript in `packages/*\/src` lists files itself or drains a
 * list the addon pages, the code tests share in `test-support` included, with
 * its bound when it says one: see {@link listingsIn}.
 */
export function scriptListings(native = nativeCrossings()) {
  const whole = new Set(native.filter((crossing) => crossing.whole).map((crossing) => crossing.js).filter((name) => !BUILT_IN.has(name)));
  const packages = readdirSync(PACKAGES, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const files = packages.flatMap((entry) => {
    const source = join(PACKAGES, entry.name, 'src');
    try {
      return filesUnder(
        source,
        (file) =>
          /\.(?:ts|tsx|mts|js|mjs)$/u.test(file) &&
          !/\.(?:test|measure|fake|fixture)\.\w+$/u.test(file) &&
          !/[/\\](?:__fixtures__|__tests__)[/\\]/u.test(file) &&
          !file.endsWith('.d.ts'),
      );
    } catch {
      return [];
    }
  });
  // A method the addon answers a page of: one taking more than `&self`, whose answer is a list.
  const paged = new Set(native.filter((crossing) => crossing.paged).map((crossing) => crossing.js).filter((name) => !BUILT_IN.has(name)));
  return files.flatMap((file) => listingsIn(file, readFileSync(file, 'utf8'), whole, paged));
}

/** What is unbounded, counted per place: the shape the baseline records. */
export function unbounded(found = everything()) {
  const counts = new Map();
  for (const crossing of found) if (crossing.bound === undefined) counts.set(crossing.at, (counts.get(crossing.at) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => codeUnitOrder(left, right)).map(([at, count]) => ({ at, count }));
}

/** Every napi crossing and every listing or drain in TypeScript. */
function everything() {
  const native = nativeCrossings();
  return [...native, ...scriptListings(native)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = everything();
  if (process.argv.includes('--write')) {
    const rows = unbounded(found);
    writeFileSync(BASELINE, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    process.stdout.write(`repo-sized: ${rows.length} unbounded place(s), recorded\n`);
  } else {
    for (const crossing of found) {
      process.stdout.write(`${crossing.bound === undefined ? 'UNBOUNDED' : 'bound    '} ${crossing.crosses.padEnd(16)} ${crossing.at}:${crossing.line}${crossing.bound === undefined ? '' : `  — ${crossing.bound}`}\n`);
    }
  }
}
