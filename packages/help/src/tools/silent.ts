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
 */
export function silentBlocks(root: string, name: string, silent: readonly SilentPackage[], named: boolean): readonly string[] {
  const held = readmes();
  const blocks: string[] = [];

  for (const one of silent) {
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
        `${one.specifier} · ${one.package}${version} — ${one.reason}`,
        shipped,
        ...(passage === undefined ? [] : [`${passage.at}:${passage.line} names \`${name}\`:`, '', passage.text]),
      ].join('\n'),
    );
  }
  return blocks;
}
