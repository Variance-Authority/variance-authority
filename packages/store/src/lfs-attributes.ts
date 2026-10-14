import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The `.gitattributes` line that routes a baseline store's images through
 * git-LFS: the pattern a template's glob is spelled as, and the one entry the
 * store adds to a file people also write by hand.
 */

/**
 * A glob as `.gitattributes` spells it: a leading run of directories dropped
 * when nothing else has a slash, because a pattern without one already matches
 * at every depth, and that is the spelling `git lfs track` writes.
 */
export function attributesPattern(glob: string): string {
  const rest = glob.startsWith('**/') ? glob.slice('**/'.length) : glob;
  return rest.includes('/') ? glob : rest;
}

/**
 * The tracking line, as `git lfs track` writes it.
 *
 * Not a tidier subset. `filter=lfs` is the attribute that moves bytes out of the
 * object database; `diff=lfs` stops `git diff` from printing pointer text as if
 * it were the change; `merge=lfs` is what the tool writes and is inert without a
 * merge driver installed. The one doing the work in the conflict story is
 * `-text`, which marks the path binary so git never attempts a line-wise merge on
 * a PNG — a binary conflict leaves one side in the tree and asks for a choice,
 * which is exactly how a baseline conflict should end.
 */
function entryFor(pattern: string): string {
  return `${pattern} filter=lfs diff=lfs merge=lfs -text`;
}

/**
 * Add the entry if it is missing, and otherwise change nothing at all.
 *
 * "Nothing at all" is the contract, not an optimisation. A `.gitattributes` is a
 * file people write by hand and share with other tools; a store that rewrote it
 * into its own preferred form would silently change how git treats paths this
 * package knows nothing about. So an existing entry for the same glob is left
 * exactly as written even when it is wrong, and the wrongness is reported instead.
 */
export async function ensureEntry(
  file: string,
  pattern: string,
): Promise<{ added: boolean; diagnostics: readonly string[] }> {
  const existing = await readIfPresent(file);

  if (existing === null) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${entryFor(pattern)}\n`, 'utf8');
    return { added: true, diagnostics: [] };
  }

  const owned = existing.split('\n').find((line) => patternOf(line) === pattern);
  if (owned !== undefined) {
    return {
      added: false,
      diagnostics: owned.includes('filter=lfs')
        ? []
        : [
            `${file} already has an entry for \`${pattern}\` that does not route it through ` +
              `LFS (\`${owned.trim()}\`); it was left as written, so images under this root ` +
              'will be committed whole',
          ],
    };
  }

  // Appended, with the original bytes untouched ahead of it. A missing trailing
  // newline in someone else's file is theirs to have; joining onto it would
  // rewrite their last line.
  await writeFile(
    file,
    `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${entryFor(pattern)}\n`,
    'utf8',
  );
  return { added: true, diagnostics: [] };
}

/**
 * The glob a `.gitattributes` line applies to, or `null` for a blank or comment.
 *
 * **Limit, stated.** git allows a quoted, C-escaped pattern; only the unescaped
 * form of a quoted pattern is recognised here. An escaped duplicate would
 * therefore be appended a second time rather than a foreign line being rewritten,
 * which is the direction that costs a redundant line instead of somebody's file.
 */
function patternOf(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const quoted = /^"([^"\\]*)"/.exec(trimmed);
  if (quoted !== null) return quoted[1] ?? null;

  return trimmed.split(/\s+/)[0] ?? null;
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}
