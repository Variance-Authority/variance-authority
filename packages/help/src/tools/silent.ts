import { readMention, readmes } from '@variance-authority/package/help';
import type { SilentPackage } from '../dependency-lexicon.js';

/**
 * What a dependency that publishes no declarations has instead.
 *
 * Such a package is silent about every name, so a question about one name cannot
 * be answered from its declarations, and "nothing found" would be read as "there
 * is nothing". Its README is the one thing it ships. When the caller named the
 * package, its README is reported whether or not it names the symbol; when they
 * did not, a package is listed only if its README does, because a line per
 * silent package on every miss would be the whole lexicon.
 *
 * The passage is the workspace mention reader's, run on the file the lexicon
 * recorded, and it is labelled as that file's — never presented as a doc comment.
 *
 * The README belongs to the package, not to the door: every door of one package
 * that falls back to it is named on its own line, and the README follows once.
 */
export function silentBlocks(root: string, name: string, silent: readonly SilentPackage[], named: boolean): readonly string[] {
  const held = readmes();
  const packages = new Map<string, SilentPackage[]>();
  for (const one of silent) {
    const key = `${one.package}@${one.version ?? ''}\0${one.readme?.at ?? ''}`;
    packages.set(key, [...(packages.get(key) ?? []), one]);
  }
  const blocks: string[] = [];

  for (const doors of packages.values()) {
    const [one] = doors;
    if (one === undefined) continue;
    const { readme } = one;
    const passage = readme === undefined || readme.unreadable !== undefined ? undefined : readMention(root, readme.at, name, held);
    if (!named && passage === undefined) continue;

    const version = one.version === undefined ? '' : `@${one.version}`;
    const shipped =
      readme === undefined
        ? 'It ships no README.md beside its manifest.'
        : readme.unreadable !== undefined
          ? `${readme.at} could not be read: ${readme.unreadable}`
          : `README: ${readme.at} (${readme.lines ?? 0} lines)`;

    blocks.push(
      [
        ...doors.map((door) => `${door.specifier} · ${door.package}${version} — ${door.reason}`),
        shipped,
        ...(passage === undefined ? [] : [`${passage.at}:${passage.line} names \`${name}\`:`, '', passage.text]),
      ].join('\n'),
    );
  }
  return blocks;
}
