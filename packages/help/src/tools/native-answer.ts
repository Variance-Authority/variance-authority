// compass: variance-authority.report.agent-surface

import { stringArg, type ToolInvocation } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { answerSymbol, answerUses, type NameAsked } from '@variance-authority/sense';
import { storeBytesOf } from '../snapshot.js';
import { FoundNothing } from './find.js';

/**
 * `symbol`'s or `uses`'s answer as the addon reads it, the one reading the
 * standalone executable answers with too, thrown as {@link FoundNothing} when
 * nothing declares the name. Absent when the answer needs a reading only the
 * tool carries — no checkout, no store, no index, or a shape the addon hands
 * back — and the tool then answers it itself.
 */
export function nativeAnswer(
  question: 'symbol' | 'uses',
  help: Help,
  invocation: ToolInvocation<Help> | undefined,
  input: Readonly<Record<string, unknown>>,
  limit: number | undefined,
): string | undefined {
  const root = invocation?.root;
  const store = storeBytesOf(help);
  if (root === undefined || store === undefined) return undefined;
  const asked: NameAsked = {
    name: stringArg(input, 'name'),
    ...said(input, 'package'),
    ...said(input, 'from'),
    ...said(input, 'file'),
    ...(limit === undefined ? {} : { limit }),
    ...(invocation?.shell === undefined ? {} : { shell: invocation.shell }),
  };
  const answer = (question === 'symbol' ? answerSymbol : answerUses)(root, store, asked);
  if (answer === undefined) return undefined;
  if (!answer.found) throw new FoundNothing(answer.text);
  return answer.text;
}

/** An input the tools read as said only when it is a word: an empty one is not said. */
function said(input: Readonly<Record<string, unknown>>, property: 'package' | 'from' | 'file'): Partial<NameAsked> {
  const value = input[property];
  return typeof value === 'string' && value !== '' ? { [property]: value } : {};
}
