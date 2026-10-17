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
 * A value whose type the line does not write — inferred from a call, a
 * generic, a subtype, a JSX attribute, a utility type — has the type a type
 * checker gives it, and none runs here. Type resolution is TypeScript's, so the
 * answer says where its own reading stops and names the declaration to ask
 * TypeScript's find-references about, rather than copying a type rule or
 * passing a text search off as the uses.
 */

// compass: variance-authority.report.agent-surface

import type { Use } from '@variance-authority/package/help';
import { memberDeclarationsOf } from '@variance-authority/sense';
import { ownerOf } from './by-path.js';

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

/** Which uses the answer lists, and which it leaves to a type checker, said once under the uses. */
export const TYPED =
  "A use is listed here only where its line writes the value's type. A use through an inferred value, a generic, a subtype by `extends` or `implements`, " +
  "a JSX attribute, a utility type or an inline type literal is not: which type a value has is a type checker's answer, and none runs here.";

/**
 * Where the uses no line types are found: TypeScript's find-references on the
 * one declaration of member `name`, or, when several declare it, on the one
 * the reader means among those the answer lists.
 */
export function routes(name: string, members: Members): readonly string[] {
  const only = members.declared.length === 1 ? members.declared[0]! : undefined;
  // A container with a name is one `used` lists; one without is named by the member alone.
  const named = members.used.some(({ declared }) => declared === only);
  const at =
    only === undefined
      ? 'the declaration you mean, each listed above with its file and line'
      : `\`${named ? `${only.by}.${name}` : name}\` at ${only.at}:${only.line}`;
  return ['', TYPED, `Ask TypeScript for those: its language service's find-references on ${at}.`];
}

/** `N places`, in words a sentence takes. */
export function places(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}
