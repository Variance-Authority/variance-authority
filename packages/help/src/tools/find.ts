import type { Documented, Entry, Help, Opening } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { importsByPath } from './by-path.js';
import { says } from './declaration-key.js';
import { declarations, unreadLine } from './declared.js';
import { type Members, membersStop } from './members.js';
import type { Spelling } from '@variance-authority/mcp/tools';
import { search } from './search.js';

/**
 * Locating the thing a question is about, and answering well when it is not there.
 *
 * Every such answer names what *is* there. A model handed "unknown package" has
 * one move left, which is to guess again; a model handed the list has the answer
 * in the same turn. The list is the expensive part of the reading and it has
 * already been read, so withholding it buys nothing.
 */

/** What a workspace with no published package is told, wherever it would have been listed. */
export const NOTHING_PUBLISHED =
  'this workspace publishes no package: no manifest it declares is both named and public';

/** The door a subpath names, written the way somebody would import it. */
export function specifierOf(published: Documented, opening: Opening): string {
  return `${published.name}${opening.subpath === '.' ? '' : opening.subpath.slice(1)}`;
}

export function packageOf(help: Help, name: string): Documented {
  const found = help.packages.find((published) => published.name === name);
  if (found !== undefined) return found;

  // An empty list printed after the colon would read as the answer. It is one,
  // but only said as a sentence: no manifest the workspace declares is public.
  if (help.packages.length === 0) throw new Error(`unknown package \`${name}\`; ${NOTHING_PUBLISHED}`);
  const known = help.packages.map((published) => published.name).join(', ');
  throw new Error(`unknown package \`${name}\`; this workspace publishes: ${known}`);
}

export function openingOf(published: Documented, subpath: string | undefined): Opening {
  const wanted = subpath ?? '.';
  const found = published.openings.find((held) => held.subpath === wanted);
  if (found !== undefined) return found;

  const known = published.openings.map((held) => held.subpath).join(', ');
  throw new Error(`\`${published.name}\` does not open \`${wanted}\`; it opens: ${known}`);
}

/**
 * The door a caller named, whether they named it as a package and a subpath or
 * as the one string that `docs_packages` prints and an import line carries.
 *
 * `docs_packages` answers with specifiers — `@scope/name/tools` — and a caller
 * who hands one straight back is doing what the answer told them to. Refusing
 * it as an unknown package and printing the thirty-five names it *is* one of
 * is a form mismatch dressed as a fact, and it was the most common wrong turn
 * on the way from the first question to the third.
 *
 * A package name wins when both readings are possible, because a subpath given
 * alongside says which reading the caller meant. Otherwise the longest package
 * name that prefixes the string is the package and the rest is its subpath;
 * longest, because `@scope/a` and `@scope/a-b` are both packages and a prefix
 * rule that stopped at the first would open the wrong one.
 */
export function doorOf(help: Help, specifier: string, subpath: string | undefined): readonly [Documented, Opening] {
  const named = help.packages.find((published) => published.name === specifier);
  if (named !== undefined || subpath !== undefined) {
    const published = named ?? packageOf(help, specifier);
    return [published, openingOf(published, subpath)];
  }

  const owner = help.packages
    .filter((published) => specifier.startsWith(`${published.name}/`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  // Not a package and not under one: `packageOf` refuses, naming what is there.
  if (owner === undefined) packageOf(help, specifier);
  if (owner === undefined) throw new Error(`\`${specifier}\` was found and then was not`);

  return [owner, openingOf(owner, `.${specifier.slice(owner.name.length)}`)];
}

/** Whether a published package is the one a caller named, by its name or by any specifier it opens. */
export function isPackage(published: Documented, opening: Opening, wanted: string): boolean {
  return published.name === wanted || specifierOf(published, opening) === wanted;
}

/**
 * Every place a name is published.
 *
 * A list rather than one entry, because a barrel and a subpath publishing the
 * same declaration is normal and answering with whichever came first would make
 * the import line a coin flip.
 */
export function entriesNamed(help: Help, name: string): readonly (readonly [Documented, Opening, Entry])[] {
  return [...everyEntry(help)].filter(([, , entry]) => entry.name === name);
}

/**
 * Why a name was not found, said so the next question is the right one.
 *
 * Exact matching is the contract of `docs_symbol` and `docs_uses`, and it
 * stays: a precise question gets a fact, never a guess dressed as an answer.
 * But the refusal is allowed to know what the search would have said. When
 * exactly one published name differs only in case, that is the name, and
 * saying so costs the caller one hop instead of three; when the name is a
 * substring of several, the count says whether `search` is worth asking.
 */
export function unfound(help: Help, name: string, within: string | undefined, spell: Spelling): string {
  const where = within === undefined ? 'this workspace' : `\`${within}\``;
  const lowered = name.toLowerCase();
  const published = new Set([...everyEntry(help)].map(([, , entry]) => entry.name));
  const alike = [...published].filter((held) => held.toLowerCase() === lowered && held !== name);
  if (alike.length === 1) return `\`${name}\` is not published by ${where}; \`${alike[0]}\` is. Names are matched exactly.`;
  if (alike.length > 1) {
    return `\`${name}\` is not published by ${where}; ${alike.map((held) => `\`${held}\``).join(' and ')} are. Names are matched exactly.`;
  }
  // `symbol` and `uses` answer an export no entry publishes, so one reaches
  // here only from outside the package asked about: the name is right, the
  // package is not, and the file says which one exports it.
  // `default` is a slot: a default nothing names was answered before here, and a named one is another name's.
  const exported = help.exported.filter((held) => says(held.name, name) && held.kind === 'source');
  if (exported.length > 0) {
    const [first] = exported;
    const more = exported.length > 1 ? ` and ${exported.length - 1} more` : '';
    const unknown =
      within !== undefined &&
      exported.some((held) => within.startsWith(`${held.by}/`)) &&
      !importsByPath(help, within).some(([deep]) => deep.specifier === within && deep.to !== undefined);
    const why = unknown ? `; no import of ${where} in this workspace resolved to a file, so the file it names is not known` : '';
    return `\`${name}\` is not published by ${where}; it is exported, without being published, at ${first?.at}:${first?.line}${more}${why}.`;
  }
  const around = [...published].filter((held) => held.toLowerCase().includes(lowered)).length;
  if (around > 0) {
    return `\`${name}\` is not published by ${where}; ${around} published ${around === 1 ? 'name contains' : 'names contain'} it — ask \`${spell.tool(search)}\` with it as the \`${spell.input('query')}\`.`;
  }
  return `\`${name}\` is not published by ${where}, and no published name contains it; ask \`${spell.tool(search)}\` with a word from its documentation.`;
}

/**
 * A name a question looked for and did not find, said as an answer rather
 * than a refusal: what was read and found nothing, and where else the name
 * may be written. It is thrown, not returned, so every surface that reads a
 * reused generation asks the question again of a current one before the
 * absence is believed, as it does for a refusal; the last reading's
 * `FoundNothing` is then given as the answer: `variance ask` and
 * `variance-authority-help` print it on stdout and exit cleanly.
 */
export class FoundNothing extends Error {
  override readonly name = 'FoundNothing';
}

/** Where a name is written that no reader here declares. */
const AS_TEXT = 'A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.';

/**
 * The answer for a name nothing in the workspace declares: that no file
 * declares it, then, given `dependencies`, what is known of the installed
 * ones, then where the reading of members stopped, then that a name written
 * only as text is a text search's to find, then the files the source
 * index holds no declarations of. Where the index could not be read, that is
 * said in place of a claim about the files. Members are read from JavaScript
 * and TypeScript only, so where the index holds files of another language the
 * claim about members is made of those two, and the others are named.
 */
export function nowhere(
  help: Help,
  name: string,
  wanted: string | undefined,
  root: string | undefined,
  members: Members | undefined,
  dependencies: string | undefined,
  spell: Spelling,
): string {
  const where = wanted === undefined ? 'this workspace' : `\`${wanted}\``;
  const read = declarations(root, name);
  const why = 'refused' in read ? read.refused : members?.unread;
  const unread = 'refused' in read ? [] : unreadLine(read.unread);
  const stop = why === undefined && members !== undefined ? membersStop(name, members) : undefined;
  // What was read and found nothing comes first, as only what was read; what was not read, last.
  const none = `No file in ${where}${unread.length === 0 ? '' : ' that the source index read'} declares \`${name}\``;
  const files = why !== undefined
    ? `Which files declare \`${name}\` is not known: ${why}.`
    : stop === undefined
      ? `${none}, at its top level or as a member.`
      : `${none} at its top level, and no JavaScript or TypeScript file declares it as a member.`;
  return [unfound(help, name, wanted, spell), files, ...(dependencies === undefined ? [] : [dependencies]), ...(stop === undefined ? [] : [stop]), AS_TEXT, ...unread].join(' ');
}
