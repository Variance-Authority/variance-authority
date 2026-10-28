#!/usr/bin/env node
import { relative } from 'node:path';
import type { Tree } from '@variance-authority/mcp/tools';
import { ask, askSearch, askSearchJson, inputFrom, invocationOf, toolNamed, verbs } from './ask.js';
import { caughtUp, foundNothingAnswer, snapshotLine } from './caught-up.js';
import { readWorkspaceForAnswer, workspaceGeneration } from './read.js';
import { readNamedTree } from './names-read.js';
import { countingShown, readSearchForAnswer } from './search-read.js';
import { discover } from './tools/discover.js';
import { intersection, namesWanted } from './tools.js';
import { search, searchQuestionOf } from './tools/search.js';
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

/**
 * An intersection one of whose questions reads every file's names: the names
 * come off the scan that draws the tree, so both are read there rather than
 * the tree the workspace reading keeps.
 */
async function crossNamed(root: string, reading: Reading, args: readonly string[]): Promise<Answering> {
  const input = inputFrom(intersection, args);
  const help = await readWorkspaceForAnswer(root, reading);
  const names = await readNamedTree(root, input);
  const at = workspaceGeneration(help);
  return {
    answer: () => {
      const answer = intersection.run(help, input, invocationOf({ ...names, root }));
      return at === undefined ? answer : `${answer}\n${snapshotLine(at, reading.justAnswer)}`;
    },
    at,
  };
}

/** How a verb reads the checkout: the generation's expiry, and the tree when it names a path. */
interface Reading {
  readonly justAnswer: boolean;
  readonly refreshAfterMs?: number;
  readonly tree?: (drawn: Tree) => void;
}

/** An answer not yet given, and the generation it will be given from. */
interface Answering {
  readonly answer: () => string;
  readonly at: string | undefined;
}

/** The longest verb and a gap, so a verb added later never runs into its description. */
const VERB_WIDTH = Math.max(...verbs().map(([verb]) => verb.length)) + 1;

const USAGE = [
  'usage: variance-authority-help <verb> [argument] [--root <dir>] [--just-answer] [--format text|json]',
  '       variance-authority-help [root] [--just-answer]',
  '       variance-authority-help write [root] [--out <dir>] [--base <url>]',
  '',
  'Ask one question:',
  ...verbs().map(([verb, description]) => `  ${verb.padEnd(VERB_WIDTH)}${description.split('. ')[0]}.`),
  '',
  '  --root  The workspace to read. Default: the working directory.',
  '  --just-answer  Use the last published generation without inspecting the checkout.',
  '  --format json  Answer `search` as data rather than text.',
  '',
  'Or:',
  '  serve  Answer every question above over MCP on stdio. The default with no verb.',
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
    if (arg === '--just-answer') continue;
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

/** One flag and its value, removed. */
function without(args: readonly string[], name: string): readonly string[] {
  const at = args.indexOf(name);
  return at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
}

/** `--root`, `--format` and their values, removed so what is left is the verb's own arguments. */
function withoutRoot(args: readonly string[]): readonly string[] {
  return without(without(args, '--root'), '--format').filter((argument) => argument !== '--just-answer');
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
    // The arrows the reading already drew, kept for a verb that names a path.
    // The scan behind every reading works out which file reaches which; taking
    // them here is what lets `search --from` mean the same thing from a shell
    // as it does over MCP, without walking the repository a second time.
    const ownArgs = withoutRoot(rest);
    const tool = toolNamed(verb);
    const format = flag(args, 'format') ?? 'text';
    if (format !== 'text' && format !== 'json') throw new Error(`--format must be text or json, not \`${format}\``);
    if (format === 'json' && tool !== search) throw new Error(`\`${verb}\` answers in text only; \`--format json\` is taken by \`search\``);
    const wantsTree = tool.wants?.(inputFrom(tool, ownArgs)) === true;
    const justAnswer = args.includes('--just-answer');
    // `search` opens the file published for it rather than the whole value, at
    // any age, so it is compared with the checkout only when nothing was
    // published and the checkout was read; `discover` reads no workspace
    // value, only the tree and its names.
    const answering = async (current: boolean): Promise<Answering> => {
      let tree: Tree | undefined;
      const reading: Reading = {
        justAnswer,
        ...(current ? { refreshAfterMs: 0 } : {}),
        ...(wantsTree ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
      };
      if (tool === search) {
        const read = await readSearchForAnswer(root, reading);
        const { index, compared } = read;
        const { importing, unopened } = await countingShown(read, searchQuestionOf(inputFrom(search, ownArgs)), tree, root);
        return { answer: () => (format === 'json' ? askSearchJson : askSearch)(index, ownArgs, () => tree, !compared, unopened, importing), at: index.generation?.generatedAt };
      }
      if (tool === discover) {
        const named = await readNamedTree(root, inputFrom(tool, ownArgs));
        return { answer: () => discover.run(undefined, inputFrom(tool, ownArgs), invocationOf({ ...named, root })), at: undefined };
      }
      if (tool === intersection && namesWanted(inputFrom(tool, ownArgs))) return crossNamed(root, reading, ownArgs);
      const help = await readWorkspaceForAnswer(root, reading);
      return { answer: () => ask(help, verb, ownArgs, () => tree, root, justAnswer), at: workspaceGeneration(help) };
    };

    const started = Date.now();
    const first = await answering(false);
    let answer: string;
    try {
      answer = first.answer();
    } catch (refusal) {
      // A refusal from a reused generation is asked again of one read now;
      // `--just-answer` and `search` read only what was published, so theirs stands.
      // A refusal whose checkout could not be compared says why.
      const caught = justAnswer || tool === search ? undefined : await caughtUp(first.at, started, root, answering);
      const footer = caught?.footer ?? (justAnswer && first.at !== undefined ? snapshotLine(first.at, true) : undefined);
      try {
        if (caught?.subject === undefined) throw refusal;
        answer = caught.subject.answer();
      } catch (still) {
        // A name not found is an answer once nothing newer can be read, dated as any other.
        const found = foundNothingAnswer(still, caught, caught?.subject !== undefined ? caught.subject.at : first.at, justAnswer);
        if (found === undefined) {
          if (footer !== undefined && still instanceof Error) still.message += `\n\n${footer}`;
          throw still;
        }
        answer = found;
      }
    }

    process.stdout.write(`${answer}\n`);
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
  serveWorkspace(positional(args)[0] ?? '.', { justAnswer: args.includes('--just-answer') });
}
