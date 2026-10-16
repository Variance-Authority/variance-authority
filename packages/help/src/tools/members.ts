/**
 * Where a member is declared and used, which no import names.
 *
 * A method or property of an interface, a type literal or a class is reached
 * through a value, never imported, so the module graph lists nobody who
 * declares or calls one. Its declarations are a fact of the parse: the scan
 * records every member each file declares, on the container that holds it,
 * and this reads the ones by one name off the source index.
 *
 * So are its uses where the line writes the value's type: a binding annotated
 * as the container, a cast to it, an object literal written as one, a pattern
 * destructuring one. The scan records the type's name as each file writes it,
 * and the index joins that name to the declaration through the import that
 * binds it, so each use is listed under the one declaration it belongs to,
 * whatever other container shares the member's name.
 *
 * A value whose type is not written — inferred from a call, a generic, a
 * mapped type — is text read near a declaration: `docs_grep` with `to` set to
 * a declaring file runs ripgrep over the files that import it, at any depth,
 * which is where a value of that type can come from. That search owns those,
 * so this answer routes to it rather than holding a second one.
 */

// compass: variance-authority.report.agent-surface

import type { Use } from '@variance-authority/package/help';
import { memberDeclarationsContaining, memberDeclarationsOf } from '@variance-authority/sense';
import { ownerOf } from './by-path.js';
import type { Matches, MemberMatch } from './search-answer.js';

/** What a text match for the callers lets in and what it misses, said once under the route. */
export const BY_NAME =
  'That search matches text, as no type checker runs: it lists comments, strings, a call by key such as ' +
  "`entry('name')` and same-named members of other types in those files, and misses a value whose type comes in " +
  'through a file that does not import the declaration.';

/** The declarations of a member by one name. */
export interface Members {
  /** Each declaration, `by` the container it is on. */
  readonly declared: readonly Use[];
  /**
   * Each declaration on a named container, in `declared`'s order, with every
   * line that uses the member through a value written as that container, `by`
   * the package and how it uses it.
   */
  readonly used: readonly { readonly declared: Use; readonly uses: readonly (Use & { readonly how: string })[] }[];
  /** Why the declarations were not read, when they were not. */
  readonly unread?: string;
}

/**
 * The declarations of member `name` the source index of the checkout at
 * `root` records, in the package `wanted` names when it names one; none, and
 * why, when no checkout is named or the index does not read.
 */
export function membersOf(root: string | undefined, name: string, wanted: string | undefined): Members {
  if (root === undefined) return { declared: [], used: [], unread: 'this host named no checkout to read the source index of' };
  let found: ReturnType<typeof memberDeclarationsOf>;
  try {
    found = memberDeclarationsOf(root, name);
  } catch (error) {
    return { declared: [], used: [], unread: `${error instanceof Error ? error.message : String(error)}; run \`variance index\`` };
  }
  if (found === undefined) return { declared: [], used: [], unread: 'no source index is published; run `variance index`' };
  const owner = wanted === undefined ? undefined : ownerOf(wanted);
  const sites = found.filter((site) => owner === undefined || site.by === owner);
  const declared = sites.map((site): Use => ({ at: site.at, line: site.line, by: site.on, kind: site.kind, type: false }));
  const used = sites.flatMap((site, at) =>
    site.uses === undefined
      ? []
      : [{ declared: declared[at]!, uses: site.uses.map((use) => ({ at: use.at, line: use.line, by: use.by, kind: use.kind, type: false, how: use.how })) }],
  );
  return { declared, used };
}

/**
 * The member declarations whose names hold `query`, as the `search` section
 * lists them: the first `cap`, source first, in `files` when an area named
 * them; nothing when no checkout was named or its index could not be read.
 */
export function memberMatches(root: string | undefined, query: string, files: Iterable<string> | undefined, cap: number): Matches<MemberMatch> | undefined {
  if (root === undefined) return undefined;
  let found: ReturnType<typeof memberDeclarationsContaining>;
  try {
    found = memberDeclarationsContaining(root, query, files);
  } catch {
    // The declared section reads the same index and says why it did not read.
    return undefined;
  }
  if (found === undefined) return undefined;
  // Stable, so the index's file-then-line order holds within a kind.
  const sites = [...found].sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]);
  return {
    total: sites.length,
    shown: sites.slice(0, cap).map((site) => ({
      source: 'member',
      name: site.name,
      on: site.on,
      ...(site.by === '' ? {} : { package: site.by }),
      at: site.at,
      line: site.line,
    })),
  };
}

/** Source before tests before stories, as the declared section orders them. */
const KIND_ORDER = { source: 0, test: 1, story: 2 } as const;

/** One member declaration, as a `search` line writes it. */
export function memberLine(held: MemberMatch): string {
  return `${held.name} — on ${held.on} — ${held.package ?? 'the repository'} · ${held.at}:${held.line}`;
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
    `A use through a value whose type is not written, or is written as no named container, is text in the files that import a declaration: docs_grep with \`query\` \`\\b${name}\\b\` and \`to\` ${to}.`,
    BY_NAME,
  ];
}

/** `N places`, in words a sentence takes. */
export function places(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}
