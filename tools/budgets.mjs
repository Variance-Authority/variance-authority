#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { parseSync } from 'oxc-parser';
import { MODULES, ROOT, tracked } from './modules.mjs';

/**
 * How many lines each written surface may hold, and which surfaces hold more.
 *
 * A file overview, a declaration's docblock, a block comment inside code and a
 * public page's lead each have a budget in content lines: blank lines, bare tags
 * and `// compass:`-style pragmas do not count. The budget is a trigger, not a
 * per-edit gate: a surface that breaches it is collapsed in the same change, its
 * overflow moved to the owner the locality ladder names. The comment is read by
 * oxc, so a docblock is told from an overview by what it is attached to, never
 * by where it sits. `yarn budgets` prints what is over; `--write` records it as
 * the debt `tools/budgets.check.ts` holds every change to.
 */

export const BASELINE = join(ROOT, 'tools/budgets.baseline.json');

/** Content lines per surface. A breach collapses the surface to about half. */
export const BUDGET = { overview: 15, docblock: 10, block: 5, lead: 15 };

const PRAGMA =
  /^\s*(?:compass:|eslint-|oxlint-|@ts-|biome-ignore|prettier-ignore|c8 |v8 |istanbul |@vitest-environment|@jsx|#region|#endregion|<reference)/;
const TAG = /^(?:@\w+(?:\s+\S+)?|\{@link\s+[^}]*\})$/;
/** What a docblock documents: a declaration, a member or a property, never a statement. */
const DECLARATION = /(?:Declaration|Definition|Signature|^TSEnumMember|^Property|^AccessorProperty)$/;
/** A statement that names other modules and declares nothing here. */
const passes = (node) =>
  node.type === 'ImportDeclaration' ||
  node.type === 'ExportAllDeclaration' ||
  (node.type === 'ExportNamedDeclaration' && node.declaration == null);
const FIXTURE = /(?:^|\/)(?:fixtures?|__fixtures__)\//;

/** The lines of one comment a reader reads: no frame, no blank, no bare tag. */
function contentOf(comment) {
  const lines =
    comment.type === 'Block'
      ? comment.value.split('\n').map((line) => line.trim().replace(/^\*+\s?/, '').trim())
      : [comment.value.trim()];
  return lines.filter(
    (line) => line !== '' && !/^\*+$/.test(line) && !TAG.test(line) && !PRAGMA.test(line.replace(/^\/\s*/, '')),
  );
}

/** The name a node declares, or nothing when it declares none. */
function nameOf(node) {
  const id = node.id ?? node.key;
  if (id?.type === 'Identifier') return id.name;
  if (id?.type === 'Literal' || id?.type === 'StringLiteral') return String(id.value);
  if (node.type === 'VariableDeclaration') return nameOf(node.declarations[0] ?? {});
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'CallExpression' && node.arguments[0]?.type === 'Literal') {
    const callee = node.callee.type === 'Identifier' ? node.callee.name : node.callee.property?.name;
    if (callee !== undefined) return `${callee}(${node.arguments[0].value})`;
  }
  if (node.type === 'ExportDefaultDeclaration') return 'default';
  return undefined;
}

/**
 * Every node start, mapped to the outermost node there, and every named range.
 *
 * The starts decide what a comment is attached to; the ranges name the scope a
 * block comment sits in, so a refusal can say which one grew.
 */
function index(program) {
  const starts = new Map();
  const scopes = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, path));
    if (node === null || typeof node !== 'object') return;
    let inner = path;
    if (typeof node.type === 'string') {
      if (node.type !== 'Program' && !starts.has(node.start)) starts.set(node.start, { node, path });
      const name = nameOf(node);
      // A declaration names its declarator's scope; naming both would say it twice.
      if (name !== undefined && node.type !== 'Identifier' && node.type !== 'VariableDeclaration') {
        inner = path === '' ? name : `${path}.${name}`;
        scopes.push({ start: node.start, end: node.end, name: inner });
      }
    }
    for (const key in node) if (key !== 'parent' && key !== 'type') walk(node[key], inner);
  };
  walk(program, '');
  return { starts, scopes };
}

/** Standalone comments, with adjacent `//` lines joined into one surface. */
function groupsOf(text, comments) {
  const groups = [];
  for (const comment of comments) {
    const lineStart = text.lastIndexOf('\n', comment.start - 1) + 1;
    if (text.slice(lineStart, comment.start).trim() !== '') continue;
    const previous = groups.at(-1);
    const between = previous === undefined ? '' : text.slice(previous.end, comment.start);
    if (previous?.type === 'Line' && comment.type === 'Line' && /^[ \t]*\n[ \t]*$/.test(between)) {
      previous.end = comment.end;
      previous.parts.push(comment);
    } else {
      groups.push({ type: comment.type, start: comment.start, end: comment.end, parts: [comment] });
    }
  }
  return groups;
}

/**
 * Each comment surface of one module: its kind, the scope it is named by, the
 * line it opens on and its content lines.
 *
 * The overview is the first comment before the first statement that is not an
 * import, unless it is a docblock attached to a declaration. A `/**` attached to
 * any other node is that node's docblock; any other comment of two lines or more
 * is a block. A one-line comment is never a surface.
 */
export function surfacesOf(file, text) {
  const { program, comments, errors } = parseSync(file, text);
  // A partial tree misplaces every comment after the error.
  if (errors.length > 0) throw new Error(`${file}: ${errors[0].message}`);
  const { starts, scopes } = index(program);
  const breaks = [];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) breaks.push(at);
  const lineOf = (offset) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (breaks[middle] < offset) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  };
  const first = program.body.find((statement) => !passes(statement) && !statement.directive);
  const firstStart = first === undefined ? text.length : first.start;
  const found = [];
  let overview = false;

  // oxc lists the hashbang among the comments; it is an interpreter line.
  const written = comments.filter((comment) => comment.start !== program.hashbang?.start);
  for (const group of groupsOf(text, written)) {
    // A one-line pragma is no surface; a pragma line in a longer comment is dropped by `contentOf`.
    const parts = group.parts.filter((part) => part.value.includes('\n') || !PRAGMA.test(part.value.replace(/^[*/]+\s*/, '')));
    if (parts.length === 0) continue;
    const gap = /^\s*/.exec(text.slice(group.end))[0];
    // Above the first statement a blank line parts an overview from the code; below it, as in TypeScript, it does not.
    const next = group.start < firstStart && /\n[ \t]*\n/.test(gap) ? undefined : starts.get(group.end + gap.length);
    const doc = group.type === 'Block' && group.parts[0].value.startsWith('*');
    const declaration = next !== undefined && !passes(next.node) && DECLARATION.test(next.node.type);
    const lines = parts.flatMap(contentOf).length;
    let kind;

    if (!overview && group.start < firstStart && !(doc && declaration && next.node.start <= firstStart)) {
      kind = 'overview';
      overview = true;
    } else if (doc && declaration) kind = 'docblock';
    else if (parts.length > 1 || parts[0].value.includes('\n')) kind = 'block';
    else continue;

    const scope =
      kind === 'overview'
        ? ''
        : kind === 'docblock'
          ? [next.path, nameOf(next.node.declaration ?? {}) ?? nameOf(next.node) ?? next.node.type].filter(Boolean).join('.')
          : (scopes.filter((range) => range.start <= group.start && group.end <= range.end).at(-1)?.name ?? '');
    found.push({ kind, scope, line: lineOf(group.start), lines });
  }
  return found;
}

/**
 * A page's lead: the content lines between its title and its first section.
 *
 * Front matter is not the page, and a page with no title has no lead to hold.
 */
export function leadOf(text) {
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  // A `#` line inside a code fence is the fence's text, not a heading.
  let fenced = false;
  const heading = lines.map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) return /^(#+) /.exec(line)?.[1].length;
    return undefined;
  });
  const title = heading.indexOf(1);
  if (title === -1) return undefined;
  const end = heading.findIndex((level, at) => at > title && level !== undefined && level >= 2);
  return lines.slice(title + 1, end === -1 ? undefined : end).filter((line) => line.trim() !== '').length;
}

/** The pages a stranger lands on: the root, `docs/` and every package README. */
const PAGE = /^(?:README\.md|docs\/(?!AGENTS\.md)[^/]+\.md|packages\/[^/]+\/README\.md)$/;


// TODO: Rust, shell, YAML and Dockerfile comments are held to no budget here; the addon's tree-sitter reader can read Rust.

/**
 * Every surface over its budget, grouped by file and kind, and where each opens.
 *
 * A key names no scope, so renaming a test or a function moves no debt; the
 * sizes, largest first, are what a change may not exceed.
 */
export function overBudget(modules, pages, read = (file) => readFileSync(join(ROOT, file), 'utf8')) {
  const debt = new Map();
  const where = new Map();
  const add = (key, lines, at) => {
    debt.set(key, [...(debt.get(key) ?? []), lines]);
    where.set(key, [...(where.get(key) ?? []), at]);
  };
  let surfaces = 0;

  for (const file of modules) {
    if (FIXTURE.test(file) || /\.d\.[cm]?ts$/.test(file)) continue;
    const found = surfacesOf(file, read(file));
    surfaces += found.length;
    for (const surface of found) {
      if (surface.lines > BUDGET[surface.kind]) {
        add(`${file} ${surface.kind}`, surface.lines, `${file}:${surface.line} ${surface.scope} (${surface.lines})`.replace('  ', ' '));
      }
    }
  }
  for (const file of pages.filter((page) => PAGE.test(page))) {
    const lines = leadOf(read(file));
    if (lines === undefined) continue;
    surfaces += 1;
    if (lines > BUDGET.lead) add(`${file} lead`, lines, `${file} (${lines})`);
  }
  for (const sizes of debt.values()) sizes.sort((a, b) => b - a);
  return { surfaces, where, debt: new Map([...debt].sort(([a], [b]) => codeUnitOrder(a, b))) };
}

/**
 * What a change did to the recorded debt: the keys it grew and the keys it paid.
 *
 * A key grew when it holds more surfaces over budget than recorded, or when any
 * of them, largest first, is longer than its recorded counterpart.
 */
export function judge(recorded, now) {
  const say = (sizes) => (sizes.length === 0 ? 'nothing' : sizes.join(', '));
  const grown = [];
  const slack = [];
  for (const key of new Set([...Object.keys(recorded), ...now.keys()])) {
    const held = recorded[key] ?? [];
    const sizes = now.get(key) ?? [];
    const line = `${key}: ${say(sizes)} (held at ${say(held)})`;
    if (sizes.length > held.length || sizes.some((size, at) => size > held[at])) grown.push(line);
    else if (sizes.length < held.length || sizes.some((size, at) => size < held[at])) slack.push(line);
  }
  return { grown, slack };
}

/** The debt as the baseline records it, refused when it grew past a recorded baseline. */
export function recordable(recorded, now) {
  const { grown } = recorded === undefined ? { grown: [] } : judge(recorded, now);
  if (grown.length > 0) throw new Error(`budgets: refusing to record growth:\n  ${grown.join('\n  ')}`);
  return `${JSON.stringify(Object.fromEntries(now), null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { debt } = overBudget(MODULES, tracked('*.md'));

  if (process.argv.includes('--write')) {
    const recorded = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined;
    writeFileSync(BASELINE, recordable(recorded, debt), 'utf8');
    const surfaces = [...debt.values()].reduce((sum, sizes) => sum + sizes.length, 0);
    process.stdout.write(`budgets: ${surfaces} surfaces over budget in ${debt.size} entries, recorded\n`);
  } else {
    process.stdout.write(`${JSON.stringify(Object.fromEntries(debt), null, 2)}\n`);
  }
}
