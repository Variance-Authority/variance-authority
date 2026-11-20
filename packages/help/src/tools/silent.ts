import { readmeMention } from '@variance-authority/sense';
import type { SilentPackage } from '../dependency-lexicon.js';

/**
 * What a dependency that publishes no declarations has instead.
 *
 * Its README is the one thing such a package ships, so a question about one of
 * its names is answered from there, not with "nothing found". A named package's
 * README is reported whether or not it names the symbol; otherwise a package is
 * listed only if its README does, or every miss would list the whole lexicon.
 * The passage is the addon's README mention, labelled as the README's, never a
 * doc comment; each door falling back to one README gets its own line, and the
 * README follows once.
 */
export function silentBlocks(root: string, name: string, silent: readonly SilentPackage[], named: boolean): readonly string[] {
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
    const passage = readme === undefined || readme.unreadable !== undefined ? undefined : readmeMention(root, readme.at, name);
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
