// compass: variance-authority.report.agent-surface

import { limitOf, spellingOf, startPointArg, stringArg, type FileSet, type ToolInvocation } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { answerSymbol, answerUses, type NameAnswer, type NameAsked } from '@variance-authority/sense';
import { storeBytesOf } from '../snapshot.js';
import { askedOnce } from './asked-once.js';
import { FoundNothing } from './find.js';

/**
 * `symbol`'s or `uses`'s answer as the addon reads it, the one reading the
 * standalone executable answers with too. Refused when the host named no
 * checkout or holds no snapshot, and when no source index is published.
 */
export function nativeAnswer(
  question: 'symbol' | 'uses',
  help: Help,
  invocation: ToolInvocation<Help> | undefined,
  input: Readonly<Record<string, unknown>>,
  limit: number | undefined,
): NameAnswer {
  const tool = `\`docs_${question}\``;
  const root = invocation?.root;
  if (root === undefined) throw new Error(`${tool} reads the source index of a checkout, and this host named none`);
  const store = storeBytesOf(help);
  if (store === undefined) throw new Error(`${tool} reads a published workspace snapshot, and this host holds none; run \`variance index\``);
  const line = question === 'symbol' && input['line'] !== undefined ? stringArg(input, 'line') : undefined;
  const asked: NameAsked = {
    name: stringArg(input, 'name'),
    ...said(input, 'package'),
    ...(question === 'symbol' ? points(input) : fromOf(said(input, 'from'))),
    ...said(input, 'file'),
    ...(limit === undefined ? {} : { limit }),
    ...(invocation?.shell === undefined ? {} : { shell: invocation.shell }),
    ...(line === undefined ? {} : { line }),
  };
  // A line is ordered by the recording, which no generation names, so only an answer without one is kept.
  const answer = line === undefined ? answeredOnce(help, question, root, JSON.stringify(asked)) : answeredNow(question, root, store, asked);
  if (answer === undefined) throw new Error(`${tool} reads the source index, and no source index is published; run \`variance index\``);
  return answer;
}

/** The addon's answer to `asked`, read now. */
function answeredNow(question: 'symbol' | 'uses', root: string, store: Uint8Array, asked: NameAsked): NameAnswer | undefined {
  return (question === 'symbol' ? answerSymbol : answerUses)(root, store, asked);
}

/**
 * The addon's answer to a question, once per generation: a tool's `run`, its
 * `files` and the look at what it rests on ask it the same, in any order.
 */
const answeredOnce = askedOnce((help: Help, question: string, root: string, asked: string) =>
  answeredNow(question as 'symbol' | 'uses', root, storeBytesOf(help)!, JSON.parse(asked) as NameAsked));

/**
 * The `limit` the question says, refused before any name is read, so a bad one
 * is said once; unsaid, the addon gives each list its own default.
 */
export function saidLimit(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined): number | undefined {
  return input['limit'] === undefined ? undefined : limitOf(input, 1, spellingOf(invocation));
}

/** The files `answer` names, each at its lines, and those it could not read. */
export function fileSetOf(answer: NameAnswer): FileSet {
  const files = new Map((answer.files ?? []).map(({ file, lines }) => [file, [...lines]]));
  return { files, ...(answer.unread.length === 0 ? {} : { unread: [...answer.unread] }) };
}

/** {@link nativeAnswer}'s answer, thrown as {@link FoundNothing} when nothing declares the name. */
export function foundAnswer(...asked: Parameters<typeof nativeAnswer>): NameAnswer {
  const answer = nativeAnswer(...asked);
  if (!answer.found) throw new FoundNothing(answer.text);
  return answer;
}

/** `symbol`'s start points, one path or several. */
function points(input: Readonly<Record<string, unknown>>): Partial<NameAsked> {
  const at = startPointArg(input, 'from');
  return at === undefined ? {} : { from: typeof at === 'string' ? [at] : [...at] };
}

/** `uses`'s one start point, said only as a word. */
function fromOf(said: { readonly from?: string }): Partial<NameAsked> {
  return said.from === undefined ? {} : { from: [said.from] };
}

/** An input the tools read as said only when it is a word: an empty one is not said. */
function said(input: Readonly<Record<string, unknown>>, property: 'package' | 'from' | 'file'): { readonly [key: string]: string } {
  const value = input[property];
  return typeof value === 'string' && value !== '' ? { [property]: value } : {};
}
