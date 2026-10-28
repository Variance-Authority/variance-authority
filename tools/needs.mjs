import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSync } from 'oxc-parser';
import { digestString } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { tokensOf } from '@variance-authority/mcp';
import { heldWeight, rarity } from '@variance-authority/mcp/tools';
import { cacheRootFor, writeCoverageBytes } from '@variance-authority/sense/test-selection';
import { isFunction, isSource, lines, visit } from './owners.mjs';

/**
 * Existing functions that need what a function new on this branch needs.
 *
 * A re-typed copy shares no run of tokens with what it copies, but it cannot
 * rename what it needs: the calls, fields, strings, patterns, types and imports
 * it names, and the words of its names. Each function is read as the set of
 * those needs, each weighed by how {@link rarity rare} it is, and compared with
 * every unit that exists by the weight of the needs both hold over the weight
 * of the needs either holds. A neighbour at {@link SHARED} or above is a lead
 * to read, not a verdict.
 * `yarn test:loop` runs this file after a green run and prints the list; journal
 * entry 0077 holds the measurements.
 */

// FIXME: the bags belong to the scan's harvest, asked through `variance ask`.
// This script parses every script a second time, beside the source index, and
// keeps a cache of its own, to prove the signal before the addon carries it.

/** The share of needs, in thousandths of the weight either holds, at which an existing function is named. */
const SHARED = 450;

/** The fewest distinct needs a function holds before it is asked about: fewer say too little to compare. */
const SMALLEST = 5;

/** The most neighbours named for one function. */
const SHOWN = 3;

/**
 * Every named function, method and function-valued property in a file's text,
 * and every top-level constant, each with the bag of what it needs.
 */
export function unitsIn(path, text) {
  const parsed = parseSync(path, text);
  if (parsed.errors.length > 0) throw new SyntaxError(`${path}: ${parsed.errors[0].message}`);
  const imported = importsOf(parsed.program);
  const lineOf = lines(text);
  const units = [];
  const unit = (name, node, kind) => {
    if (typeof name === 'string' && name !== '') units.push({ path, name, kind, line: lineOf(node.start), bag: bagOf(node, name, imported) });
  };
  // A constant is the module's when a statement of the module declares it, not a block or a loop inside one.
  const declared = new Set(parsed.program.body.flatMap((statement) => (statement.declaration ?? statement).declarations ?? []));
  visit(parsed.program, (node) => {
    if (node.type === 'FunctionDeclaration') unit(node.id?.name, node, 'function');
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      if (node.init && isFunction(node.init)) unit(node.id.name, node, 'function');
      else if (declared.has(node) && node.init) unit(node.id.name, node, 'constant');
    }
    if (['MethodDefinition', 'Property', 'PropertyDefinition'].includes(node.type) && node.value && isFunction(node.value)) {
      unit(keyOf(node.key), node, 'function');
    }
  });
  return units;
}

/**
 * Whether a unit is asked about: a function holding {@link SMALLEST} distinct
 * needs or more, and not a constructor, which needs what its class holds rather
 * than what it does.
 */
export const asks = (unit) => unit.kind === 'function' && unit.name !== 'constructor' && unit.bag.length >= SMALLEST;

/**
 * For each function in `added` the tool {@link asks} about, the existing units
 * that need what it needs, nearest first.
 *
 * Rarity is counted over `existing`, the code a new function is measured
 * against. The share is the weighted Jaccard index in thousandths, rounded
 * down from integers, so a tie is a tie on every machine, and it breaks by
 * path, then name, then line.
 */
export function twinsOf(added, existing) {
  const weight = rarityIn(existing);
  const weighed = (bag) => heldWeight(bag, weight, () => 1);
  const held = existing.map((unit) => ({ needs: new Set(unit.bag), weight: weighed(unit.bag) }));
  const found = [];
  for (const unit of added) {
    if (!asks(unit)) continue;
    const own = weighed(unit.bag);
    const shareWith = ({ needs, weight: theirs }) => {
      const both = weighed(unit.bag.filter((need) => needs.has(need)));
      const either = own + theirs - both;
      return either === 0 ? 0 : Math.floor((1000 * both) / either);
    };
    const twins = existing
      .map((other, index) => ({ other, share: shareWith(held[index]) }))
      .filter(({ other, share }) => share >= SHARED && !(other.path === unit.path && other.name === unit.name))
      .sort(
        (left, right) =>
          right.share - left.share ||
          codeUnitOrder(left.other.path, right.other.path) ||
          codeUnitOrder(left.other.name, right.other.name) ||
          left.other.line - right.other.line,
      )
      .slice(0, SHOWN)
      .map(({ other, share }) => ({ path: other.path, name: other.name, line: other.line, share }));
    if (twins.length > 0) found.push({ unit, twins });
  }
  return found;
}

/**
 * The functions new on this branch, against `origin/main` where it was cut, and
 * their twins in the working tree as it is now.
 *
 * New means a name its file did not hold at the branch point, so an edit to an
 * existing function asks nothing and a function moved to another file asks
 * again. What exists is every unit in the working tree that is not new: a
 * function gone from the tree is not one to call.
 */
export function needs(root) {
  const base = mergeBase(root);
  const changed = new Set(
    [...listed(git(root, ['diff', '--name-only', '--no-renames', base])), ...listed(git(root, ['ls-files', '--others', '--exclude-standard']))].filter(
      isSource,
    ),
  );
  const cache = cached(root);
  const unread = new Set();
  const files = present(root);
  const written = unitsOf(root, files.filter(({ path }) => changed.has(path)), cache, unread);
  const before = new Set(atBase(root, base, [...changed], cache, new Set()).map((unit) => `${unit.path}\0${unit.name}`));
  const isNew = (unit) => !before.has(`${unit.path}\0${unit.name}`);
  const added = written.filter(isNew);
  // Nothing to ask about needs nothing else read.
  if (!added.some(asks)) return { added, twins: [], unread: [...unread].sort(codeUnitOrder), cache };
  const existing = [...written.filter((unit) => !isNew(unit)), ...unitsOf(root, files.filter(({ path }) => !changed.has(path)), cache, unread)];
  cache.whole = true;
  return { added, twins: twinsOf(added, existing), unread: [...unread].sort(codeUnitOrder), cache };
}

function mergeBase(root) {
  try {
    return git(root, ['merge-base', 'HEAD', 'origin/main']).trim();
  } catch (error) {
    // Exit 1 is two histories with no common commit; 128 with this text is a checkout with no `origin/main`.
    // Anything else, a corrupt object or an unreadable repository, is git's to say.
    if (error.status === 1 || /Not a valid object name|unknown revision/i.test(error.message)) {
      throw new Error('no merge base with origin/main to measure the branch from');
    }
    throw error;
  }
}

/**
 * What `yarn test:loop` prints: each new function with twins, and the twins,
 * or one line that none was named, which clears nothing, since the list misses
 * copies; then each file oxc could not parse, whose functions are neither asked
 * about nor named.
 */
export function said({ added, twins, unread }) {
  const asked = added.filter(asks).length;
  const out =
    asked === 0
      ? ['needs: no new function to ask about']
      : twins.length === 0
        ? [`needs: no existing function named for the ${asked} new functions asked about; that clears none of them`]
        : [`needs: ${twins.length} of ${asked} new functions asked about need what existing ones need. Read them; where one answers, call or extend it:`];
  for (const { unit, twins: near } of twins) {
    out.push(`  ${unit.path}:${unit.line} ${unit.name}`);
    for (const twin of near) out.push(`    ${(twin.share / 1000).toFixed(3)} ${twin.path}:${twin.line} ${twin.name}`);
  }
  for (const path of unread) out.push(`needs: oxc could not parse ${path}, so its functions are not read`);
  return `${out.join('\n')}\n`;
}

/**
 * Writes the units this run read, keyed by blob, when they differ from what the
 * cache held. A run that read every file keeps only what it read; a run that
 * read only the change keeps what the cache held besides.
 */
export async function remember(cache) {
  const blobs = cache.whole ? cache.read : new Map([...cache.blobs, ...cache.read]);
  if (!cache.changed && blobs.size === cache.blobs.size) return;
  const bytes = new TextEncoder().encode(JSON.stringify({ reader: cache.reader, blobs: Object.fromEntries(blobs) }));
  await writeCoverageBytes(cache.file, bytes);
}

/**
 * The list for `root`, or one line naming what kept it from being read: the
 * list is advice, so it never fails the loop that prints it.
 */
export async function advice(root) {
  try {
    const found = needs(root);
    const list = said(found);
    try {
      await remember(found.cache);
    } catch (error) {
      return `${list}needs: cache not written, ${String(error?.message ?? error).split('\n')[0]}\n`;
    }
    return list;
  } catch (error) {
    return `needs: not read, ${String(error?.message ?? error).split('\n')[0]}\n`;
  }
}

const require = createRequire(import.meta.url);

/**
 * The texts that shape a bag: this file, the owners helpers it calls and the
 * module that declares `tokensOf`. The bags a run read are cached by blob and
 * the language its path names, under the digest of these and the parser's
 * version, so an edit to any of them drops what the last reader wrote.
 */
export const READS = [
  fileURLToPath(import.meta.url),
  fileURLToPath(new URL('./owners.mjs', import.meta.url)),
  join(dirname(require.resolve('@variance-authority/mcp')), 'tools', 'locate-index.js'),
];

const reader = () => digestString([...READS.map((path) => readFileSync(path, 'utf8')), require('oxc-parser/package.json').version].join('\0'));

// What the cache held, or nothing when it was written by another reader or
// cannot be read: a cache is a shortcut, never an answer.
function cached(root) {
  const file = join(cacheRootFor(root), 'needs.json');
  let held;
  try {
    held = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  } catch {
    held = undefined;
  }
  const digest = reader();
  const blobs = held?.reader === digest ? new Map(Object.entries(held.blobs)) : new Map();
  return { file, reader: digest, blobs, read: new Map(), changed: held?.reader !== digest, whole: false };
}

// Every source in the working tree, with its blob when the index holds it as
// it is on disk; a file edited or new has none.
function present(root) {
  const edited = new Set([...listed(git(root, ['diff', '--name-only'])), ...listed(git(root, ['ls-files', '--others', '--exclude-standard']))]);
  const files = [...edited].filter((path) => isSource(path) && existsSync(join(root, path))).map((path) => ({ path }));
  for (const row of listed(git(root, ['ls-files', '-s']))) {
    const [meta, path] = row.split('\t');
    if (!edited.has(path) && isSource(path) && existsSync(join(root, path))) files.push({ path, blob: meta.split(' ')[1] });
  }
  return files;
}

// The units of `files`: one with a blob through the cache, one without parsed
// from disk. A file oxc cannot parse is added to `unread`.
function unitsOf(root, files, cache, unread) {
  const text = (path) => () => readFileSync(join(root, path), 'utf8');
  return files.flatMap(({ path, blob }) =>
    blob === undefined ? parsedOr(unread, path, () => unitsIn(path, text(path)())) : throughCache(cache, blob, path, text(path), unread),
  );
}

// The units each of `paths` held at `base`, read through the cache by blob.
function atBase(root, base, paths, cache, unread) {
  if (paths.length === 0) return [];
  const units = [];
  for (const row of listed(git(root, ['ls-tree', base, '--', ...paths]))) {
    const [meta, path] = row.split('\t');
    const blob = meta.split(' ')[2];
    units.push(...throughCache(cache, blob, path, () => git(root, ['cat-file', 'blob', blob]), unread));
  }
  return units;
}

function throughCache(cache, blob, path, text, unread) {
  // oxc reads a text by the language its path's extension names, so one blob
  // at two extensions is two readings.
  const key = `${blob}${extname(path)}`;
  let held = cache.blobs.get(key);
  if (held === undefined) {
    held = parsedOr(unread, path, () => unitsIn(path, text()).map(({ name, kind, line, bag }) => ({ name, kind, line, bag })));
    if (unread.has(path)) return [];
    cache.changed = true;
  }
  cache.read.set(key, held);
  return held.map((unit) => ({ path, ...unit }));
}

function parsedOr(unread, path, read) {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    unread.add(path);
    return [];
  }
}

/** Git's output in `root`, as text, or as bytes when `encoding` is `'buffer'`. */
export const git = (root, args, { input, encoding = 'utf8' } = {}) => {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, input, encoding, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    // One line, git's own first: `execFileSync` opens with `Command failed:` and puts the reason lines below it.
    const reason = String(error?.stderr ?? '').split('\n').find((line) => line.trim() !== '') ?? String(error?.message ?? error).split('\n')[0];
    const failed = new Error(`git ${args[0]}: ${reason}`);
    failed.status = error?.status;
    throw failed;
  }
};
const listed = (out) => out.split('\n').filter((line) => line !== '');

const keyOf = (key) => (key?.type === 'Identifier' || key?.type === 'PrivateIdentifier' ? key.name : typeof key?.value === 'string' ? key.value : undefined);

// Each binding a module imports, as the module and the name it exports. A
// relative module is this repository's own and says nothing a path would not.
function importsOf(program) {
  const imported = new Map();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const from = statement.source.value.startsWith('.') ? '' : statement.source.value;
    for (const specifier of statement.specifiers ?? []) {
      const name = specifier.type === 'ImportSpecifier' ? (specifier.imported.name ?? specifier.imported.value) : specifier.local.name;
      imported.set(specifier.local.name, `${from}#${name}`);
    }
  }
  return imported;
}

// A static member chain, `a.b.c`, or undefined when a link is computed.
function chainOf(node) {
  if (node === null || node === undefined) return undefined;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression' && !node.computed && node.property) return `${chainOf(node.object) ?? '?'}.${node.property.name}`;
  if (node.type === 'ChainExpression' || node.type === 'TSNonNullExpression' || node.type === 'ParenthesizedExpression') return chainOf(node.expression);
  return undefined;
}

/**
 * What one unit needs, each once, in code-unit order: `call:` each function it calls by its last
 * name, and by its module or receiver; `prop:` each field it reads; `str:` and
 * `re:` each short string and pattern it writes; `type:` each type it names;
 * `imp:` each import it uses; `word:` the words of every name it binds or reads;
 * `name:` the words of its own name.
 */
function bagOf(root, name, imported) {
  const bag = new Set();
  const add = (token) => bag.add(token);
  for (const word of tokensOf(name)) add(`name:${word}`);
  visit(root, (node) => {
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const chain = chainOf(node.callee);
      if (chain !== undefined) {
        const links = chain.split('.');
        const last = links.at(-1);
        const from = imported.get(links[0]);
        add(`call:${last}`);
        if (links.length > 1) add(`call:${(from === undefined ? '' : from.split('#')[0]) || links[0]}.${last}`);
        else if (from !== undefined) add(`call:${from}`);
      }
    }
    if (node.type === 'Literal') {
      if (typeof node.value === 'string' && node.value.length <= 60) add(`str:${node.value}`);
      if (node.regex) add(`re:${node.regex.pattern}`);
    }
    if (node.type === 'TemplateElement') {
      const text = node.value?.cooked ?? node.value?.raw;
      if (text && text.trim() && text.length <= 60) add(`str:${text}`);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.name) add(`prop:${node.property.name}`);
    if (node.type === 'TSTypeReference') {
      const type = chainOf(node.typeName) ?? node.typeName?.right?.name;
      if (type !== undefined) add(`type:${type.split('.').at(-1)}`);
    }
    if (node.type === 'Identifier' && node.name) {
      for (const word of tokensOf(node.name)) add(`word:${word}`);
      if (imported.has(node.name)) add(`imp:${imported.get(node.name)}`);
    }
  });
  return [...bag].sort(codeUnitOrder);
}

// The rarity of each need over `units`: a need every unit holds weighs least,
// a need none holds weighs most.
function rarityIn(units) {
  const holders = new Map();
  for (const unit of units) for (const token of unit.bag) holders.set(token, (holders.get(token) ?? 0) + 1);
  return (token) => rarity(units.length, holders.get(token) ?? 0);
}

// Run as `node tools/needs.mjs`, the last step of `yarn test:loop`: the list on
// stderr, beside the runner's own, and exit 0 whatever it says.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write(await advice(process.cwd()));
}
