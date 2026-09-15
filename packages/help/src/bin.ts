#!/usr/bin/env node
import { relative } from 'node:path';
import { ask, toolNamed, verbs } from './ask.js';
import { readWorkspace } from './read.js';
import { serveWorkspace } from './server.js';
import { writePages } from './write.js';

/**
 * `variance-authority-help` — ask one question, serve them all, or write them out.
 *
 * Three ways to reach one reading, because the three callers are genuinely
 * different. A coding agent with a client that holds connections wants the MCP
 * server. A documentation site wants `write`. Somebody — or an agent with a
 * shell and no interest in editing a config file — wants one answer now, and
 * that is what the verbs are for.
 *
 * Beyond that, no config file. Everything either of the other verbs could be
 * configured to *do* would be a decision about somebody else's repository: which
 * packages count is their `workspaces` field, what each publishes is their
 * `exports` map, and what matters within it is which of it their own code
 * imports. All three are already written down, and a flag that disagreed with
 * one of them would be a fourth source of truth nobody asked for.
 */

const USAGE = [
  'usage: variance-authority-help <verb> [argument] [--root <dir>]',
  '       variance-authority-help [root]',
  '       variance-authority-help write [root] [--out <dir>] [--base <url>]',
  '',
  'Ask one question:',
  ...verbs().map(([verb, description]) => `  ${verb.padEnd(11)}${description.split('. ')[0]}.`),
  '',
  '  --root  The workspace to read. Default: the working directory.',
  '',
  'Or:',
  '  serve  Answer all six over MCP on stdio. The default with no verb.',
  '  write  Write llms.txt, help-index.md, help-gaps.md and help.json.',
  '',
  '  --out   Where the written files go. Default: docs/api under the root.',
  '  --base  Prefix put in front of every path, for pages read away from the checkout.',
].join('\n');

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

/** Everything that is not a flag or a flag's value. The first of them is the root. */
function positional(args: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) at += 1;
    else found.push(arg);
  }
  return found;
}

/** A verb the tool list knows, or nothing — asked without throwing at the unknown. */
function asking(word: string | undefined): boolean {
  if (word === undefined) return false;
  try {
    toolNamed(word);
    return true;
  } catch {
    return false;
  }
}

/** `--root` and its value, removed so what is left is the verb's own arguments. */
function withoutRoot(args: readonly string[]): readonly string[] {
  const at = args.indexOf('--root');
  return at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
}

const [, , ...args] = process.argv;

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const [verb, ...rest] = args;

if (asking(verb) && verb !== undefined) {
  const root = flag(args, 'root') ?? '.';
  try {
    process.stdout.write(`${ask(await readWorkspace(root), verb, withoutRoot(rest))}\n`);
  } catch (failure) {
    // A refusal is the answer here, not a crash: every one of them names what is
    // there instead, and a stack trace above it buries the only useful line.
    process.stderr.write(`${failure instanceof Error ? failure.message : String(failure)}\n`);
    process.exit(1);
  }
} else if (verb === 'write') {
  const root = positional(rest)[0] ?? '.';
  const out = flag(rest, 'out') ?? `${root}/docs/api`;
  const base = flag(rest, 'base');
  const written = writePages(root, out, base === undefined ? {} : { base });
  for (const file of written) {
    // Relative while it stays under the working directory, absolute the moment it
    // does not: a path that opens with six `../` is harder to read than the one
    // it was shortening.
    const near = relative(process.cwd(), file.at);
    const at = near.startsWith('..') ? file.at : near;
    process.stdout.write(`${at} — ${file.bytes} bytes\n`);
  }
} else {
  serveWorkspace(positional(args)[0] ?? '.');
}
