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
 * checker gives it, and none runs here. Type resolution is the checker's of the
 * declaration's language, TypeScript's for JavaScript and TypeScript, so the
 * answer says where its own reading stops and names the declaration to ask
 * that checker's find-references about, rather than copying a type rule or
 * passing a text search off as the uses.
 */

// compass: variance-authority.report.agent-surface

import type { Use } from '@variance-authority/package/help';
import { LANGUAGES, type LanguageId, languageOf, memberDeclarationsOf, readsMembers } from '@variance-authority/sense';
import { ownerOf } from './by-path.js';
import type { Spelling } from '@variance-authority/mcp/tools';

/** The declarations of a member by one name. */
export interface Members {
  /** The member asked for, without the container a dotted name puts it on. */
  readonly member: string;
  /** The container a dotted name puts the member on, as written. */
  readonly on?: string;
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
  /**
   * The languages of the files the source index holds whose members the scan
   * does not record, by name; absent when the declarations were not read.
   */
  readonly elsewhere?: readonly string[];
}

/** The container a member is declared on, as a sentence names it. */
export function containerOf(by: string): string {
  return /^a (?:type literal|class)$/u.test(by) ? by : `\`${by}\``;
}


/**
 * The member a name asks for and the container it is on: `Tree.chainsTo` is
 * `chainsTo` on `Tree`, read off the last dot as written, never resolved.
 */
export function memberName(name: string): { readonly member: string; readonly on?: string } {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? { member: name } : { member: name.slice(dot + 1), on: name.slice(0, dot) };
}

/**
 * The declarations of member `name` the source index of the checkout at
 * `root` records, in the package `wanted` names when it names one; none, and
 * why, when no checkout is named or the index does not read. A name written
 * `Container.member` keeps the declarations on the container by that name.
 */
export function membersOf(root: string | undefined, name: string, wanted: string | undefined): Members {
  const asked = memberName(name);
  const { member, on } = asked;
  if (root === undefined) return { ...asked, declared: [], used: [], unread: 'this host named no checkout to read the source index of' };
  let found: ReturnType<typeof memberDeclarationsOf>;
  try {
    found = memberDeclarationsOf(root, member);
  } catch (error) {
    return { ...asked, declared: [], used: [], unread: `${error instanceof Error ? error.message : String(error)}; run \`variance index\`` };
  }
  if (found === undefined) return { ...asked, declared: [], used: [], unread: 'no source index is published; run `variance index`' };
  const owner = wanted === undefined ? undefined : ownerOf(wanted);
  const sites = found.sites.filter((site) => (owner === undefined || site.by === owner) && (on === undefined || site.on === on));
  const declared = sites.map((site): Use => ({ at: site.at, line: site.line, by: site.on, kind: site.kind, type: false }));
  const used = sites.flatMap((site, at) =>
    site.uses === undefined
      ? []
      : [{ declared: declared[at]!, uses: site.uses.map((use) => ({ at: use.at, line: use.line, by: use.by, kind: use.kind, type: false, how: use.how })) }],
  );
  return { ...asked, declared, used, elsewhere: unreadMemberLanguages(found.extensions) };
}

/** Which uses the answer lists, and which it leaves to a type checker, said once under the uses. */
export const TYPED =
  "A use is listed here only where its line writes the value's type. A use through an inferred value, a generic, a subtype by `extends`, " +
  "a JSX attribute, a utility type or an inline type literal is not: which type a value has is a type checker's answer, and none runs here.";

/**
 * Where the uses no line types are found: find-references on the one
 * declaration of member `name`, or, when several declare it, on the one the
 * reader means among those the answer lists, which `package` narrows to when
 * the list is cut. It is asked of the type checker of the language the
 * declarations are written in: TypeScript's language service for JavaScript
 * and TypeScript, that language's own language server for any other, and each
 * declaration's own when they are written in more than one. Its
 * go-to-implementation on the same declaration names the implementations
 * that take their type from where they go, which write none on their line.
 */
/** Whose type checker answers for declarations in these files: TypeScript's for JavaScript and TypeScript alone, `other` for one other language, `mixed` for several. */
export function checkerOf(files: readonly string[]): 'typescript' | 'other' | 'mixed' {
  const languages = new Set(files.map(languageOf));
  return languages.size > 1 ? 'mixed' : languages.size === 0 || languages.has('module') ? 'typescript' : 'other';
}

export function routes(members: Members, spell: Spelling): readonly string[] {
  const name = members.member;
  const only = members.declared.length === 1 ? members.declared[0]! : undefined;
  // A container with a name is one `used` lists; one without is named by the member alone.
  const named = members.used.some(({ declared }) => declared === only);
  const at =
    only === undefined
      ? `the declaration you mean, each listed above with its file and line (\`${spell.input('package')}\` narrows the declarations to one package)`
      : `\`${named ? `${only.by}.${name}` : name}\` at ${only.at}:${only.line}`;
  const checker = checkerOf(members.declared.map((site) => site.at));
  const ask =
    checker === 'mixed'
      ? "Ask the declaration's own language's type checker for those: its find-references"
      : checker === 'typescript'
        ? "Ask TypeScript for those: its language service's find-references"
        : "Ask the declaration's own language for those: its language server's find-references";
  // An object that takes the container from where it goes implements the member with no type on its line; a class that writes `implements` is a use.
  const which = only === undefined ? 'the declaration you mean' : `${only.at}:${only.line}`;
  const gap =
    `An implementation of \`${named && only !== undefined ? `${only.by}.${name}` : name}\` that takes its type from where it goes — an argument, a property, a returned value — ` +
    `writes no type on its line and is not listed: ${checker === 'typescript' ? "TypeScript's" : "its language server's"} go-to-implementation on ${which} names it.`;
  const stop = membersStop(members);
  return ['', gap, TYPED, `${ask} on ${at}.`, ...(stop === undefined ? [] : [stop])];
}

/**
 * What each language whose members the scan does not record is called in a
 * sentence. A stylesheet declares no members, so it has no name here.
 */
const UNREAD_MEMBERS: Readonly<Record<Exclude<LanguageId, 'module' | 'style'>, string>> = {
  python: 'Python',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
};

/**
 * The languages of files by these `extensions` whose members the scan does
 * not record, by name, in the order a reader is looked for.
 */
function unreadMemberLanguages(extensions: readonly string[]): readonly string[] {
  const held = new Set(extensions.map(languageOf));
  return LANGUAGES.filter((id): id is keyof typeof UNREAD_MEMBERS => held.has(id) && !readsMembers(id) && id in UNREAD_MEMBERS).map(
    (id) => UNREAD_MEMBERS[id],
  );
}

/**
 * Where a reading of the member asked for stops, given the languages `elsewhere`
 * names: members are read from JavaScript and TypeScript only, so a member of
 * those languages' files is their language server's to find, beside any
 * declaration the answer lists. Nothing when there are none, or the
 * declarations were not read.
 */
export function membersStop(members: Members): string | undefined {
  const name = members.member;
  const languages = members.elsewhere ?? [];
  if (languages.length === 0) return undefined;
  const there = members.declared.length === 0 ? 'there' : 'there too';
  const named = languages.length === 1 ? languages[0]! : `${languages.slice(0, -1).join(', ')} and ${languages.at(-1)!}`;
  return (
    `Members are read from JavaScript and TypeScript files only, and this workspace's ${named} files were not read for them: ` +
    `if \`${name}\` is a member ${there}, ask their language server's workspace symbols for it, then its find-references on the declaration.`
  );
}

/** `N places`, in words a sentence takes. */
export function places(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}
