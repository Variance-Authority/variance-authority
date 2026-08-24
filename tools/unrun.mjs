#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What is written and has never run, printed from the source that owns it.
 *
 * The project's own status — a limb that is not written, a defect in code that
 * ships, a claim that would hold if something ran — is a **marker at the line
 * that owns it**, never a paragraph in `docs/`. A paragraph rots in one
 * direction: its optimistic half gets corrected the moment somebody trips over
 * it, and its pessimistic half survives the work landing, because nothing fails
 * when a negative stops being true. A marker cannot rot that way, because
 * closing the gap deletes the claim.
 *
 * This is the reader for that ledger. It has no build step and no dependency —
 * `node tools/unrun.mjs` from a fresh clone — because a self-report that needs
 * the project to compile first cannot report on the project failing to compile.
 *
 * It exists at all because **vitest's default reporter prints no title for a
 * todo or a skipped test**. `yarn test` ends with `… | 24 todo (1913)` and not
 * one of the twenty-four sentences, which is the same silent-green shape
 * `tools/skips.check.ts` was written against.
 *
 * Discovery is `git ls-files`, so a marker inside `node_modules/`, a `dist/` or
 * a built `storybook-static/` is not a marker: it is somebody else's, and it is
 * not in the tree.
 *
 * `tools/unrun.check.ts` holds the markers to their shape and this file to its
 * count.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Root manifest name, for markers that belong to no workspace. */
const REPOSITORY = 'variance-authority';

/**
 * Where a marker can be written.
 *
 * Shell and YAML included, because CI is where several of these live and a
 * workflow step nobody runs is exactly the shape this ledger is for. Markdown is
 * not: prose is the medium this mechanism exists to replace.
 */
const SCANNED = /\.(ts|tsx|js|jsx|mjs|cjs|sh|yml|yaml)$/;

/** This file and its checker spell the markers in order to find them. */
const SELF = new Set(['tools/unrun.mjs', 'tools/unrun.check.ts']);

/** A comment opener, at the start of a line: `//`, `/*`, a block's `*`, or `#`. */
const OPENER = /^[ \t]*(?:\/\/+|\/\*+|\*+\/?|#+)[ \t]?/;

/** The same openers, anywhere on a line, followed by the word. */
export const SPELLING = /(?:\/\/|\/\*+|^[ \t]*\*|#)[ \t]*(TODO|FIXME)\b(:?)/;

/** A todo test, however its title is spelled. */
export const TODO_CALL = /\b(?:it|test)\.todo[ \t]*\(/g;

const LITERAL = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

export function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file !== '' && existsSync(join(ROOT, file)) && SCANNED.test(file) && !SELF.has(file));
}

/**
 * The argument list of a call whose `(` is at `open`.
 *
 * Parens are balanced with the quote state tracked, so a title containing `(`
 * does not end the call early. Titles here are long and several of them name a
 * function, so that is not hypothetical.
 */
function callText(text, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
}

/** Every string literal in a call, concatenated — `'a' + 'b'` is one title. */
function titleOf(argument) {
  const parts = [...argument.matchAll(LITERAL)].map((match) => match[2].replace(/\\(.)/g, '$1'));
  return parts.length === 0 ? null : parts.join('');
}

function lineAt(text, index) {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

function tidy(text) {
  return text
    .replace(/\*\/[ \t]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Comment markers in one file, each carrying every continuation line.
 *
 * A marker is usually several lines — what is missing, and what closes it — and
 * printing only the first is how a ledger stops being read. Continuation stops
 * at the first line that is not a comment or that opens a marker of its own.
 */
function commentsIn(file, text) {
  const lines = text.split('\n');
  const found = [];

  for (let index = 0; index < lines.length; index += 1) {
    const head = SPELLING.exec(lines[index]);
    if (head === null) continue;

    const line = index + 1;
    const body = [lines[index].slice(head.index + head[0].length)];
    if (OPENER.test(lines[index])) {
      for (let next = index + 1; next < lines.length; next += 1) {
        if (!OPENER.test(lines[next]) || SPELLING.test(lines[next])) break;
        body.push(lines[next].replace(OPENER, ''));
        index = next;
      }
    }
    found.push({ file, line, kind: head[1], text: tidy(body.join(' ')) });
  }
  return found;
}

function todosIn(file, text) {
  const found = [];
  for (const match of text.matchAll(TODO_CALL)) {
    const open = match.index + match[0].length - 1;
    const argument = callText(text, open);
    found.push({
      file,
      line: lineAt(text, match.index),
      kind: 'todo',
      text: argument === null ? null : titleOf(argument),
    });
  }
  return found;
}

/** Which workspace owns a path, by the manifest that sits above it. */
export function ownerOf(file) {
  const parts = file.split('/');
  if (parts.length > 2 && ['packages', 'examples', 'cases'].includes(parts[0])) {
    const manifest = join(ROOT, parts[0], parts[1], 'package.json');
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).name;
  }
  return REPOSITORY;
}

/** Every marker in the tree, sorted by path then line — code units, never a locale. */
export function markers() {
  const found = [];
  for (const file of tracked()) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    // Comment markers first so a `// TODO:` above an `it.todo` reads in the order
    // it was written; the sort below settles it either way.
    found.push(...commentsIn(file, text), ...todosIn(file, text));
  }
  return found.sort((one, two) => {
    if (one.file !== two.file) return one.file < two.file ? -1 : 1;
    return one.line - two.line;
  });
}

const LEGEND = {
  todo: 'a claim that would hold if something ran',
  TODO: 'a limb that is not written',
  FIXME: 'a defect in code that ships',
};

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

export function report(found) {
  const files = new Set(found.map((marker) => marker.file));
  const out = [`unrun: ${found.length} gaps in ${files.size} files`, ''];
  for (const [kind, meaning] of Object.entries(LEGEND)) {
    out.push(`  ${kind.padEnd(6)} ${meaning}`);
  }

  const owners = [...new Set(found.map((marker) => ownerOf(marker.file)))].sort((one, two) =>
    one < two ? -1 : one > two ? 1 : 0,
  );

  for (const owner of owners) {
    out.push('', owner);
    for (const marker of found.filter((entry) => ownerOf(entry.file) === owner)) {
      out.push(`  ${marker.file}:${marker.line}  ${marker.kind}`);
      for (const line of wrap(marker.text ?? '(no literal title)', 84)) out.push(`      ${line}`);
    }
  }
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Always exit 0. This is a report, not a gate: `yarn verify` fails on defects
  // and a gap that is honestly declared is not one.
  process.stdout.write(`${report(markers())}\n`);
}
