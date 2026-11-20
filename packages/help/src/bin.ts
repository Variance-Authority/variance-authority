#!/usr/bin/env node
import { relative } from 'node:path';
import type { Tree } from '@variance-authority/mcp/tools';
import { ask, askSearch, askSearchJson, countingShown, inputFrom, invocationOf, toolNamed, verbs } from './ask.js';
import { foundNothingAnswer, refusalFooter, snapshotLine } from './caught-up.js';
import { readWorkspaceForAnswer } from './read.js';
import { workspaceGeneration } from './snapshot.js';
import { readGenerationNames, readNamedTree } from './names-read.js';
import { readSearchForAnswer } from './search-read.js';
import { containment, containmentOf, formatContainment } from './tools/containment.js';
import { discover } from './tools/discover.js';
import { intersection, journeyMapTool, namesWanted, orient, retriedTests, slowestTests, testCompositionTool } from './tools.js';
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
 * An intersection one of whose questions reads every file's names: the tree
 * comes with the workspace value, and the names off the parses the published
 * source index holds beside it.
 */
async function crossNamed(root: string, reading: Reading, args: readonly string[]): Promise<Answering> {
  const input = inputFrom(intersection, args);
  let tree: Tree | undefined;
  const help = await readWorkspaceForAnswer(root, { ...reading, tree: (drawn) => { tree = drawn; } });
  const names = { ...(tree === undefined ? {} : { tree }), names: await readGenerationNames(help, root) };
  const at = workspaceGeneration(help);
  return {
    answer: () => {
      const answer = intersection.run(help, input, invocationOf({ ...names, root }));
      return at === undefined ? answer : `${answer}\n${snapshotLine(at, true)}`;
    },
    at,
  };
}

/** How a verb reads: the published generation alone, and its tree when it names a path. */
interface Reading {
  readonly justAnswer: true;
  readonly tree?: (drawn: Tree) => void;
}

/** An answer not yet given, and the generation it will be given from. */
interface Answering {
  readonly answer: () => string;
  readonly at: string | undefined;
}

/** The verbs that open the recording a run published and nothing else, so no generation is read for them, as `variance ask` reads none. */
const RECORDED = [orient, slowestTests, retriedTests, journeyMapTool, testCompositionTool];

/** The longest verb and a gap, so a verb added later never runs into its description. */
const VERB_WIDTH = Math.max(...verbs().map(([verb]) => verb.length)) + 1;

const USAGE = [
  'usage: variance-authority-help <verb> [argument] [--root <dir>] [--format text|json]',
  '       variance-authority-help [root] [--just-answer]',
  '       variance-authority-help write [root] [--out <dir>] [--base <url>]',
  '',
  'Ask one question:',
  ...verbs().map(([verb, description]) => `  ${verb.padEnd(VERB_WIDTH)}${description.split('. ')[0]}.`),
  '',
  '  --root  The workspace to read. Default: the working directory.',
  '  --format json  Answer `search` or `containment` as data rather than text.',
  '',
  'A question answers from the generation `variance index` published, and never',
  'reads the checkout to bring it up to date: after an edit, run `variance index`.',
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
  return without(without(args, '--root'), '--format');
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
    if (format === 'json' && tool !== search && tool !== containment) throw new Error(`\`${verb}\` answers in text only; \`--format json\` is taken by \`search\` and \`containment\``);
    const wantsTree = tool.wants?.(inputFrom(tool, ownArgs)) === true;
    if (args.includes('--just-answer')) throw new Error('`--just-answer` is taken by `serve`: a question always answers from the published generation');
    // `search` opens the file published for it rather than the whole value;
    // `discover` reads no workspace value, only the tree and its names.
    const answering = async (): Promise<Answering> => {
      let tree: Tree | undefined;
      const reading: Reading = {
        justAnswer: true,
        ...(wantsTree ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
      };
      if (tool === search) {
        const read = await readSearchForAnswer(root, reading);
        const { index } = read;
        const { importing, unopened } = await countingShown(read, searchQuestionOf(inputFrom(search, ownArgs)), tree, root);
        return { answer: () => (format === 'json' ? askSearchJson : askSearch)(index, ownArgs, () => tree, true, unopened, importing), at: index.generation?.generatedAt };
      }
      if (tool === discover) {
        const { at, ...named } = await readNamedTree(root, inputFrom(tool, ownArgs));
        return {
          answer: () => {
            const answer = discover.run(undefined, inputFrom(tool, ownArgs), invocationOf({ ...named, root }));
            return at === undefined ? answer : `${answer}\n${snapshotLine(at, true)}`;
          },
          at,
        };
      }
      const recorded = RECORDED.find((one) => one.name === tool.name);
      if (recorded !== undefined) return { answer: () => recorded.run(undefined, inputFrom(tool, ownArgs), invocationOf({ root })), at: undefined };
      // The log and the workspace list answer it, so no workspace value is read.
      if (tool === containment) {
        const figures = containmentOf(root, inputFrom(tool, ownArgs));
        return { answer: () => (format === 'json' ? JSON.stringify(figures, undefined, 2) : formatContainment(figures)), at: undefined };
      }
      if (tool === intersection && namesWanted(inputFrom(tool, ownArgs))) return crossNamed(root, reading, ownArgs);
      const help = await readWorkspaceForAnswer(root, reading);
      return { answer: () => ask(help, verb, ownArgs, () => tree, root, true), at: workspaceGeneration(help) };
    };

    const first = await answering();
    let answer: string;
    try {
      answer = first.answer();
    } catch (refusal) {
      // A refusal answers from the generation it was refused from, dated as any
      // other answer; keeping that fresh is `variance index`'s job, not a question's.
      const found = foundNothingAnswer(refusal, undefined, first.at, true);
      if (found === undefined) {
        const footer = refusalFooter(first.at, true);
        if (footer !== undefined && refusal instanceof Error) refusal.message += `\n\n${footer}`;
        throw refusal;
      }
      answer = found;
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
