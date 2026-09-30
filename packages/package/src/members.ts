import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { globSync } from 'tinyglobby';
import { parse } from 'yaml';

/**
 * Which manifests a workspace lists, answered by the parties that own each half
 * of the question, and read as pnpm reads them.
 *
 * A member list is written in YAML or JSON and read as globs, and neither of
 * those is a language this package defines. `yaml` says what a
 * `pnpm-workspace.yaml` holds — a list at its key's own indent, a flow list, a
 * quoted key, a byte-order mark — and `tinyglobby` says what an entry matches.
 * What an entry *means* is pnpm's: `normalizePatterns` in
 * `@pnpm/workspace.package-patterns` turns every entry, negated or not, into a
 * glob for the manifest inside the directories it names, and that one rewrite
 * is what makes a symbolic link a member, keeps a wildcard out of `.next`, and
 * makes `!packages/a` leave `packages/a/b` alone. Reading an entry as a glob
 * for directories answers most lists and misreads those three, and a misread
 * member list is a workspace missing members with nothing said.
 */

/** Directories no member list reaches into, whatever its entries say — pnpm's own two. */
const NEVER = ['**/node_modules/**', '**/bower_components/**'];

/**
 * The manifest names a member directory is read by, in the order one is
 * preferred over another in the same directory.
 *
 * npm and yarn read only `package.json`. pnpm also reads `package.yaml` and
 * `package.json5`, and prefers them in that order.
 */
// TODO: pnpm also reads a `package.json5` member; reading one needs a JSON5
// parser this package does not depend on, so such a member is not listed.
const PNPM_MANIFESTS = ['package.json', 'package.yaml'];
const NPM_MANIFESTS = ['package.json'];

/**
 * Every manifest the root's `workspaces` field reaches, or, when the root
 * manifest names none, the `packages:` of a `pnpm-workspace.yaml` beside it.
 *
 * An entry names directories, and the member is the manifest inside each one:
 * `packages/*` is read as `packages/*\/package.json`. So a directory that is a
 * symbolic link is a member when its manifest is, and a wildcard does not match
 * a name that starts with a dot — `packages/**` stays out of `.next` and
 * `.turbo`, while an entry that spells `packages/.internal` out reads it. A
 * negated entry is rewritten the same way, so `!packages/a` leaves out the
 * manifest in `packages/a` and nothing under it, and it applies to every other
 * entry wherever it is written. pnpm applies a negated wildcard to names that
 * start with a dot as well, and so does this.
 *
 * Entries are read in the order they are written, and the directories one entry
 * matches in code-unit order, `a` before `a-b`: a listing that follows the file
 * is one somebody can check against it. A directory two entries reach — twice
 * by name, or once by name and once through a link — is one member, listed
 * where it was first reached.
 *
 * The root is a member whatever the list says, and it is listed first. pnpm
 * reads it so (`includeRoot`), and so does yarn berry. npm leaves its root out
 * of `--workspaces`, but `npm publish` at the root publishes it, and what is
 * published is the question this answers; a root that is not published says
 * `private: true`, which yarn classic requires of a workspace root anyway.
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

  const declared = workspacesOf(manifest, read(manifest)['workspaces']);
  const pnpm = declared.length > 0 ? undefined : pnpmMembers(root);
  const entries = declared.length > 0 ? declared : (pnpm ?? []);
  if (entries.length === 0) return [manifest];

  const names = pnpm === undefined ? NPM_MANIFESTS : PNPM_MANIFESTS;
  const excluded = new Set(
    globSync(manifestGlobs(negatedIn(entries), names), { cwd: root, expandDirectories: false, dot: true, ignore: NEVER }),
  );

  const seen = new Set<string>();
  const found: string[] = [];
  const add = (path: string): void => {
    const real = realpathSync(dirname(path));
    if (seen.has(real)) return;
    seen.add(real);
    found.push(path);
  };

  add(manifest);
  for (const entry of entries) {
    if (entry.startsWith('!')) continue;
    const matched = globSync(manifestGlobs([entry], names), { cwd: root, expandDirectories: false, ignore: NEVER });
    for (const path of preferred(matched.filter((path) => !excluded.has(path)), names)) add(join(root, path));
  }
  return found;
}

/** One glob per manifest name for the directories each entry names, as pnpm's `normalizePatterns` writes it. */
function manifestGlobs(entries: readonly string[], names: readonly string[]): string[] {
  return entries.flatMap((entry) => names.map((name) => entry.replace(/\/?$/, `/${name}`)));
}

/**
 * The bodies of the negated entries, normalized as pnpm normalizes them.
 *
 * An absolute body excludes nothing, because every path it is matched against
 * is relative to the root.
 */
function negatedIn(entries: readonly string[]): string[] {
  return entries
    .filter((entry) => entry.startsWith('!'))
    .map((entry) => entry.slice(1))
    .filter((body) => !body.startsWith('/'))
    .map((body) => posix.normalize(body));
}

/**
 * One manifest per directory, the name `names` prefers first, with the
 * directories in code-unit order.
 *
 * Sorted on the directory rather than on the manifest path: `a/package.json`
 * sorts after `a-b/package.json`, because `/` is a larger code unit than `-`,
 * and the directory `a` belongs before `a-b`.
 */
function preferred(paths: readonly string[], names: readonly string[]): string[] {
  const byDir = new Map<string, string>();
  for (const path of paths) {
    const dir = posix.dirname(path);
    const held = byDir.get(dir);
    const rank = (at: string): number => names.indexOf(posix.basename(at));
    if (held === undefined || rank(path) < rank(held)) byDir.set(dir, path);
  }
  return [...byDir.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).map((dir) => byDir.get(dir)!);
}

/**
 * The entries a root manifest's `workspaces` field lists, as an array or as
 * yarn's `{ packages }`; none when it has no such field.
 *
 * A field of any other shape is refused naming the manifest, as npm refuses it,
 * and so is an entry that is not a glob.
 */
function workspacesOf(manifest: string, workspaces: unknown): readonly string[] {
  if (workspaces === undefined || workspaces === null) return [];
  const listed = Array.isArray(workspaces)
    ? workspaces
    : typeof workspaces === 'object'
      ? (workspaces as { packages?: unknown }).packages
      : workspaces;
  if (listed === undefined || listed === null) return [];
  return globsIn(manifest, '`workspaces`', listed);
}

/**
 * The member globs `pnpm-workspace.yaml` declares, or `undefined` when there is
 * no such file or it declares no `packages:`.
 *
 * pnpm keeps its workspace here and not in the root manifest, so a pnpm root
 * read only for `workspaces` is a private one-package repository that publishes
 * nothing. A file that is not YAML, a file that is not a mapping, or a
 * `packages:` that is not a list of globs is refused naming the file, as pnpm
 * refuses it: a list half-read is a workspace missing members.
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
  if (held === null || held === undefined) return undefined;
  if (typeof held !== 'object' || Array.isArray(held)) {
    throw new Error(`${path} holds ${Array.isArray(held) ? 'a list' : `a ${typeof held}`}, where pnpm reads a mapping`);
  }

  const listed = (held as { packages?: unknown }).packages;
  if (listed === null || listed === undefined) return undefined;
  return globsIn(path, '`packages:`', listed);
}

/** `listed` as a list of globs, or an error naming `file` and saying which entry is not one. */
function globsIn(file: string, field: string, listed: unknown): readonly string[] {
  if (!Array.isArray(listed)) throw new Error(`${file} declares ${field} as something other than a list of globs`);
  for (const entry of listed) {
    if (entry === '') throw new Error(`${file} lists an empty entry in ${field}, which names no directory`);
    if (typeof entry !== 'string') {
      throw new Error(`${file} lists ${JSON.stringify(entry)} in ${field}, which is a ${typeof entry} rather than a glob`);
    }
  }
  return listed as string[];
}
