import type { FileSet, ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { questionIdentity, sourceIndexPath } from '@variance-authority/sense';
import type { SearchIndex } from '../search-index.js';
import { publishedSourceIndex, searchIndexOf } from '../snapshot.js';
import { preparedSearch } from './search-answer.js';
import type { SearchQuestion, Searched, Matches } from './search-matches.js';
import { importingOf } from './published-match.js';
import { declarationLookupsOf } from './declaration-key.js';

// compass: variance-authority.report.agent-surface

interface Reading {
  readonly files: () => FileSet;
  readonly read: () => Searched;
}
interface Asked {
  readonly help: Help;
  readonly index: SearchIndex;
  readonly tree: Tree | undefined;
  readonly key: string;
}
interface Held extends Asked {
  readonly reading: Reading;
}

const questions = new WeakMap<object, Held[]>();
const printed = new WeakMap<Help, Asked & { readonly files: ReadonlySet<string> }>();

function askedOf(help: Help, question: SearchQuestion, invocation: ToolInvocation<Help> | undefined): Asked {
  const root = invocation?.root;
  const source = root === undefined ? undefined : publishedSourceIndex(help, sourceIndexPath(root));
  return { help, index: searchIndexOf(help), tree: invocation?.tree, key: JSON.stringify([question, root, source]) };
}

const same = (left: Asked, right: Asked): boolean =>
  left.help === right.help && left.index === right.index && left.tree === right.tree && left.key === right.key;

/** Matching and rendered facts live only in the existing synchronous question. */
export function searchReading(help: Help, question: SearchQuestion, invocation: ToolInvocation<Help> | undefined): Reading {
  const asked = askedOf(help, question, invocation);
  const identity = questionIdentity();
  const held = identity === undefined ? undefined : questions.get(identity);
  const previous = held?.find((one) => same(one, asked));
  if (previous !== undefined) return previous.reading;
  const prepared = preparedSearch(asked.index, question, invocation?.tree, invocation?.root);
  let found: Searched | undefined;
  const reading: Reading = {
    files: prepared.files,
    read: () => {
      found ??= prepared.read(importingOf(help, invocation?.root), declarationLookupsOf(help, invocation?.root));
      printed.set(help, { ...asked, files: footprint(found) });
      return found;
    },
  };
  if (identity !== undefined) {
    const entries = held ?? [];
    if (held === undefined) questions.set(identity, entries);
    entries.push({ ...asked, reading });
  }
  return reading;
}

/** Only the last rendered footprint survives a question, for the later age check. */
export function renderedFiles(help: Help, question: SearchQuestion, invocation: ToolInvocation<Help> | undefined): ReadonlySet<string> {
  const previous = printed.get(help);
  if (previous !== undefined && same(previous, askedOf(help, question, invocation))) return previous.files;
  return footprint(searchReading(help, question, invocation).read());
}

function footprint({ answer, publishing = new Set<string>() }: Searched): ReadonlySet<string> {
  const sections: readonly (Matches<{ readonly at: string }> | undefined)[] = [answer.published, answer.exported, answer.declared, answer.held, answer.aliases, answer.loose, answer.described];
  return new Set([...sections.flatMap((section) => section?.shown.map((row) => row.at) ?? []), ...publishing]);
}
