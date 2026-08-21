import type { Documented, Entry, Help, Opening } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';

/**
 * Locating the thing a question is about, and refusing well when it is not there.
 *
 * Every refusal here names what *is* there. A model handed "unknown package" has
 * one move left, which is to guess again; a model handed the list has the answer
 * in the same turn. The list is the expensive part of the reading and it has
 * already been read, so withholding it buys nothing.
 */

/** The door a subpath names, written the way somebody would import it. */
export function specifierOf(published: Documented, opening: Opening): string {
  return `${published.name}${opening.subpath === '.' ? '' : opening.subpath.slice(1)}`;
}

export function packageOf(help: Help, name: string): Documented {
  const found = help.packages.find((published) => published.name === name);
  if (found !== undefined) return found;

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
 * Every place a name is published.
 *
 * A list rather than one entry, because a barrel and a subpath publishing the
 * same declaration is normal and answering with whichever came first would make
 * the import line a coin flip.
 */
export function entriesNamed(help: Help, name: string): readonly (readonly [Documented, Opening, Entry])[] {
  return [...everyEntry(help)].filter(([, , entry]) => entry.name === name);
}
