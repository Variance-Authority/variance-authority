#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { ROOT } from './owners.mjs';

/**
 * Where a list with one entry per file of the checkout could reach the JS heap.
 *
 * A checkout of 400k files is 400k strings in V8 before anything is done with
 * them, and the operation that asked usually wanted ten rows. Such a list is
 * forbidden: it stays in Rust, and JS receives an answer bounded by the
 * question — a top-N, a page with a limit, a count, one file, or a set the
 * caller scoped by name.
 *
 * Two places can break that, and this reads both out of their source:
 *
 * - a napi export (`#[napi]` in `packages/sense/native/src`) that takes or
 *   returns a collection — `Vec`, a map or set, a typed array, or a
 *   `#[napi(object)]` holding one;
 * - TypeScript in `packages/*\/src` that lists files itself: `git ls-files`,
 *   `git ls-tree`, a glob, a recursive `readdir`, or a function that reads a
 *   directory and calls itself.
 *
 * Each is allowed when its source says what bounds it, on a `bound:` line in
 * the comment right above (`/// bound: …` in Rust, `// bound: …` in
 * TypeScript). A bound names the limit, never the hope: "at most `limit`
 * rows", "the files the asker named", "the chain's segments". "Small in
 * practice" is the reason this file exists.
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

/** The `bound:` line in the comment block that ends right above `line`, if there is one. */
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

/** Every napi export that takes or returns a collection, with its bound when it says one. */
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
      if (/^(?:pub )?fn |^\}/u.test(lines[line])) owner = /^\}/u.test(lines[line]) ? '' : owner;
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
      const crosses = [holdsCollection(args, objects) && 'takes', holdsCollection(returns, objects) && 'returns'].filter(Boolean);
      if (crosses.length === 0) continue;
      found.push({
        at: `${relative(ROOT, file)} ${owner === '' ? '' : `${owner}.`}${name}`,
        line: line + 1,
        crosses: crosses.join(' and '),
        bound: boundAbove(lines, line, '//'),
      });
    }
  }
  return found;
}

const LISTING = /'ls-files'|'ls-tree'|\bglobSync\(|\bglob\(|\bfg(?:\.sync)?\(|readdir(?:Sync)?\([^)]*recursive:\s*true/u;

/** The name of the function `line` sits in, and whether that function reads a directory and calls itself. */
function enclosing(lines, line) {
  for (let at = line; at >= 0; at -= 1) {
    const named = /^(?:export )?(?:async )?function\*? (\w+)|^(?:export )?const (\w+) = (?:async )?\(/u.exec(lines[at]);
    if (!named) continue;
    const name = named[1] ?? named[2];
    let end = at + 1;
    while (end < lines.length && !/^\}/u.test(lines[end]) && !/^\S/u.test(lines[end])) end += 1;
    const body = lines.slice(at + 1, end + 1).join('\n');
    return { name, recurses: new RegExp(`\\b${name}\\(`, 'u').test(body) && /\breaddir(?:Sync)?\(/u.test(body) };
  }
  return { name: '(top level)', recurses: false };
}

/** Every place shipped TypeScript lists files itself, with its bound when it says one. */
export function scriptListings() {
  const packages = readdirSync(PACKAGES, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const files = packages.flatMap((entry) => {
    const source = join(PACKAGES, entry.name, 'src');
    try {
      return filesUnder(
        source,
        (file) =>
          /\.(?:ts|tsx|mts|js|mjs)$/u.test(file) &&
          !/\.(?:test|measure|fake|fixture)\.\w+$/u.test(file) &&
          !/[/\\](?:test-support|__fixtures__|__tests__)[/\\]/u.test(file) &&
          !file.endsWith('.d.ts'),
      );
    } catch {
      return [];
    }
  });
  const found = [];
  const recursions = new Set();
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let line = 0; line < lines.length; line += 1) {
      const text = lines[line];
      const lists = LISTING.test(text);
      const reads = /\breaddir(?:Sync)?\(/u.test(text);
      if (!lists && !reads) continue;
      const fn = enclosing(lines, line);
      if (!lists && !fn.recurses) continue;
      const at = `${relative(ROOT, file)} ${fn.name}`;
      if (!lists) {
        if (recursions.has(at)) continue;
        recursions.add(at);
      }
      found.push({ at, line: line + 1, crosses: lists ? 'lists' : 'walks', bound: boundAbove(lines, line, '//') ?? (/\/\/ bound:\s*(\S.*)$/u.exec(text)?.[1]) });
    }
  }
  return found;
}

/** What is unbounded, counted per place: the shape the baseline records. */
export function unbounded(found = [...nativeCrossings(), ...scriptListings()]) {
  const counts = new Map();
  for (const crossing of found) if (crossing.bound === undefined) counts.set(crossing.at, (counts.get(crossing.at) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => codeUnitOrder(left, right)).map(([at, count]) => ({ at, count }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = [...nativeCrossings(), ...scriptListings()];
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
