#!/usr/bin/env node
import { relative } from 'node:path';
import { serveWorkspace } from './server.js';
import { writePages } from './write.js';

/**
 * `variance-authority-help [root]` — serve, or `write` the same answers as files.
 *
 * Two verbs, no config file. Everything either verb could be configured to *do*
 * would be a decision about somebody else's repository: which packages count is
 * their `workspaces` field, what each publishes is their `exports` map, and what
 * matters within it is which of it their own code imports. All three are already
 * written down, and a flag that disagreed with one of them would be a fourth
 * source of truth nobody asked for.
 */

const USAGE = [
  'usage: variance-authority-help [root]',
  '       variance-authority-help write [root] [--out <dir>] [--base <url>]',
  '',
  '  serve  Answer questions about the workspace over MCP on stdio. Default.',
  '  write  Write llms.txt, help-index.md, help-gaps.md and help.json.',
  '',
  '  --out   Where the files go. Default: docs/api under the root.',
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

const [, , ...args] = process.argv;

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const writing = args[0] === 'write';
const rest = writing ? args.slice(1) : args;
const root = positional(rest)[0] ?? '.';

if (writing) {
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
  serveWorkspace(root);
}
