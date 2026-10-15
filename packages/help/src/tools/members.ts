/**
 * Where a member is declared, which no import names.
 *
 * A method or property of an interface, a type literal or a class is reached
 * through a value, never imported, so the module graph lists nobody who
 * declares or calls one. Its declarations are a fact of the parse: ripgrep
 * picks the files whose text could declare the name, and the sense addon
 * parses those and keeps the members by that name, on the container that
 * holds each.
 *
 * Its callers are text read near a declaration: `docs_grep` with `to` set to
 * a declaring file runs ripgrep over the files that import it, at any depth,
 * which is where a value of that type can come from. That search owns callers,
 * so this answer routes to it rather than holding a second one.
 */

// compass: variance-authority.report.agent-surface

import type { Use } from '@variance-authority/package/help';
import { memberDeclarationsOf } from '@variance-authority/sense';
import { ownerOf } from './by-path.js';
import { filesMatching } from './ripgrep.js';

/** What a text match for the callers lets in and what it misses, said once under the route. */
export const BY_NAME =
  'That search matches text, as no type checker runs: it lists comments, strings, a call by key such as ' +
  "`entry('name')` and same-named members of other types in those files, and misses a value whose type comes in " +
  'through a file that does not import the declaration.';

/** The declarations of a member by one name. */
export interface Members {
  /** Each declaration, `by` the container it is on. */
  readonly declared: readonly Use[];
  /** Why the declarations were not read, when they were not. */
  readonly unread?: string;
}

/** A name a member can be declared under without quotes; any other is no member this answers for. */
const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

/**
 * A line that could declare member `name`: the name, quoted or not, not read
 * off a value, then what follows a member's key — `?`, `!`, `:`, `(`, `<`, `=`
 * or `;`. Only a prefilter: the parse decides.
 */
function declaring(name: string): string {
  const escaped = name.replace(/\$/g, '\\$');
  return `(?:^|[^.\\w$])['"]?${escaped}['"]?\\s*[?!]?\\s*[:(<=;]`;
}

/**
 * The declarations of member `name` in the checkout at `root`, in the package
 * `wanted` names when it names one; none, and why, when no checkout is named
 * or ripgrep or the addon could not read them.
 */
export function membersOf(root: string | undefined, name: string, wanted: string | undefined): Members {
  if (!IDENTIFIER.test(name)) return { declared: [] };
  if (root === undefined) return { declared: [], unread: 'this host named no checkout to read' };
  let found: ReturnType<typeof memberDeclarationsOf>;
  try {
    found = memberDeclarationsOf(root, filesMatching(root, declaring(name)), name);
  } catch (error) {
    return { declared: [], unread: error instanceof Error ? error.message : String(error) };
  }
  const owner = wanted === undefined ? undefined : ownerOf(wanted);
  const declared = found
    .filter((site) => owner === undefined || site.by === owner)
    .map((site): Use => ({ at: site.at, line: site.line, by: site.on, kind: site.kind, type: false }));
  return { declared };
}

/**
 * Where the callers of member `name` are read: the one declaring file, or,
 * when several declare it, the one whose container the caller means, which
 * `package` narrows to when the list is cut.
 */
export function routes(name: string, members: Members): readonly string[] {
  const files = new Set(members.declared.map((site) => site.at));
  const to =
    files.size === 1
      ? `\`${[...files][0]}\``
      : 'the file that declares the container you mean (`package` narrows the declarations to one package)';
  return [
    '',
    `Its callers are text in the files that import a declaration: docs_grep with \`query\` \`\\b${name}\\b\` and \`to\` ${to}.`,
    BY_NAME,
  ];
}

/** `N places`, in words a sentence takes. */
export function places(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}
