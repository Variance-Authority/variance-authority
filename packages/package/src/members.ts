import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'tinyglobby';
import { parse } from 'yaml';

/**
 * Which manifests a workspace lists, answered by the parties that own each half
 * of the question.
 *
 * A member list is written in YAML or JSON and read as globs, and neither of
 * those is a language this package defines. `yaml` says what a
 * `pnpm-workspace.yaml` holds — a list at its key's own indent, a flow list, a
 * quoted key, a byte-order mark — and `tinyglobby`, the matcher pnpm's own
 * workspace reader is built on, says what an entry matches, negated entries
 * included. Reading either by hand answers most files and misreads the rest,
 * and a misread member list is a workspace missing members with nothing said.
 */

/** Directories no member list reaches into, whatever its globs say. */
const NEVER = ['**/node_modules', '**/.git'];

/**
 * Every manifest the root's `workspaces` field reaches, or, when the root
 * manifest names none, the `packages:` of a `pnpm-workspace.yaml` beside it.
 *
 * Entries are read in the order they are written, and the directories one entry
 * matches in code-unit order: a listing that follows the file is one somebody
 * can check against it. A negated entry excludes what it matches from every
 * other entry, wherever it is written, which is how pnpm reads the same list. A
 * directory two entries match is one member.
 *
 * A repository with no `workspaces` at all, or an empty one, is one package, and
 * that is the interesting case for anybody who is not a monorepo.
 *
 * A repository with no root manifest publishes nothing, and that is an answer
 * rather than an error. Plenty of checkouts are not npm projects at all — a
 * Swift application with a landing page under it, a service with a web client in
 * a subdirectory — and the question *where is the thing that does X* is asked of
 * those more often than of a monorepo. Nothing is published there, so nothing is
 * on the published half of an answer, and everything the source exports is still
 * read.
 */
export function members(root: string, read: (path: string) => Record<string, unknown>): readonly string[] {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return [];

  const { workspaces } = read(manifest);
  const declared = Array.isArray(workspaces)
    ? (workspaces as string[])
    : (((workspaces as { packages?: string[] } | undefined)?.packages ?? []) as string[]);
  const globs = declared.length > 0 ? declared : (pnpmMembers(root) ?? []);
  if (globs.length === 0) return [manifest];

  const excluded = globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  const found = new Set<string>();
  for (const glob of globs) {
    if (glob.startsWith('!')) continue;
    const dirs = globSync([glob], {
      cwd: root,
      onlyDirectories: true,
      expandDirectories: false,
      dot: true,
      ignore: [...NEVER, ...excluded],
    });
    for (const dir of dirs.sort()) {
      const at = join(root, dir, 'package.json');
      if (existsSync(at)) found.add(at);
    }
  }
  return [...found];
}

/**
 * The member globs `pnpm-workspace.yaml` declares, or `undefined` when there is
 * no such file or it declares no `packages:`.
 *
 * pnpm keeps its workspace here and not in the root manifest, so a pnpm root
 * read only for `workspaces` is a private one-package repository that publishes
 * nothing. A file that is not YAML, or a `packages:` that is not a list of
 * strings, is refused naming the file: a list half-read is a workspace missing
 * members.
 */
function pnpmMembers(root: string): readonly string[] | undefined {
  const path = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(path)) return undefined;

  let held: unknown;
  try {
    held = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not readable YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof held !== 'object' || held === null || !('packages' in held)) return undefined;

  const listed = (held as { packages: unknown }).packages;
  if (listed === null || listed === undefined) return undefined;
  if (!Array.isArray(listed) || !listed.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error(`${path} declares \`packages:\` as something other than a list of globs`);
  }
  return listed;
}
