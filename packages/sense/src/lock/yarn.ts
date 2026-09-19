/**
 * `yarn.lock`, in both of the formats that name.
 *
 * Classic (v1) is not YAML. It is Yarn's own line format — a heading of
 * comma-joined descriptors ending in a colon, then `key "value"` pairs with no
 * colon between them — and it is still the lockfile of a large number of live
 * repositories, so it gets its own reader rather than a YAML reader with
 * exceptions.
 *
 * Berry (v2 and later) is YAML with a `__metadata` block, and is read through
 * [`yaml.ts`](./yaml.ts).
 */

import { Packages, packageNameOf, type Lockfile } from './lockfile.js';
import { mapAt, readYaml, textAt, Unreadable, unquoted } from './yaml.js';

/** Whether this text is a berry lockfile rather than a classic one. */
export function isBerry(text: string): boolean {
  return /^__metadata:/m.test(text);
}

/**
 * Berry's own `__metadata.version`, which is the format version and not Yarn's.
 *
 * A floor with no ceiling. Yarn 2 wrote 4, Yarn 3 wrote 6, Yarn 4 writes 8 and
 * 10, and the entry shape this reads — a descriptor key, `resolution`,
 * `checksum`, a `dependencies` map of names to ranges — has not moved once
 * across any of them. A ceiling would turn every Yarn release into a repository
 * that runs its whole suite until someone edits this number, which is a cost
 * paid on a format that did not change.
 *
 * Below the floor is a different file. Versions 1 to 3 are the classic format
 * under a `__metadata` header, and reading them as berry would find no entries
 * at all — so they are refused by name rather than answered with an empty
 * install.
 */
const BERRY_FLOOR = 4;

export function readYarnBerry(text: string): Lockfile {
  const root = readYaml(text);
  const metadata = mapAt(root, '__metadata');
  const version = metadata === undefined ? undefined : textAt(metadata, 'version');
  const declared = version === undefined ? Number.NaN : Number(unquoted(version));

  if (!Number.isInteger(declared) || declared < BERRY_FLOOR) {
    throw new Unreadable(
      `yarn.lock declares __metadata.version ${version ?? '(absent)'}, and this reader reads ` +
        `${BERRY_FLOOR} and above`,
    );
  }

  const packages = new Packages();

  for (const [descriptors, entry] of root) {
    if (descriptors === '__metadata' || typeof entry === 'string') continue;

    const resolution = textAt(entry, 'resolution');
    // `pkg@workspace:packages/ui` is one of ours. Its files are in the file
    // graph already, and its `dependencies` are how those files reach a package
    // — which the scan reads from the imports themselves, more precisely than a
    // manifest can.
    if (resolution !== undefined && unquoted(resolution).includes('@workspace:')) continue;

    const identity = [resolution, textAt(entry, 'checksum'), textAt(entry, 'version')]
      .filter((part) => part !== undefined)
      .map(unquoted)
      .join(' ');

    // One entry answers every descriptor that resolved to it, and each of them
    // names the same package — but an alias descriptor does not, so they are
    // read rather than assumed.
    const names = new Set(descriptors.split(',').map((one) => packageNameOf(unquoted(one.trim()))));
    for (const name of names) packages.add(name, identity);

    const dependencies = mapAt(entry, 'dependencies');
    if (dependencies === undefined) continue;
    for (const name of names) {
      for (const on of dependencies.keys()) packages.depend(name, on);
    }
  }

  return packages.done('yarn-berry');
}

export function readYarnClassic(text: string): Lockfile {
  const packages = new Packages();
  let names: readonly string[] = [];
  let identity: string[] = [];
  let inDependencies = false;

  const close = (): void => {
    for (const name of names) packages.add(name, identity.join(' '));
  };

  for (const [index, raw] of text.split('\n').entries()) {
    const indent = raw.length - raw.trimStart().length;
    const body = raw.slice(indent).trimEnd();
    if (body === '' || body.startsWith('#')) continue;

    if (indent === 0) {
      close();
      if (!body.endsWith(':')) {
        throw new Unreadable(`line ${index + 1}: \`${body.slice(0, 60)}\` is not an entry heading`);
      }
      names = [
        ...new Set(body.slice(0, -1).split(',').map((one) => packageNameOf(unquoted(one.trim())))),
      ];
      identity = [];
      inDependencies = false;
      continue;
    }

    if (indent === 2) {
      // `dependencies:` and `optionalDependencies:` open a block; an optional
      // dependency is read as an ordinary one, because a file that imports it
      // is reached by its change whether or not the install was allowed to skip
      // it.
      inDependencies = body.endsWith('Dependencies:') || body === 'dependencies:';
      if (inDependencies) continue;

      const field = fieldOf(body);
      if (field !== undefined && IDENTIFYING.has(field.key)) identity.push(field.value);
      continue;
    }

    if (indent >= 4 && inDependencies) {
      const field = fieldOf(body);
      if (field === undefined) continue;
      for (const name of names) packages.depend(name, field.key);
    }
  }

  close();
  return packages.done('yarn-classic');
}

/** The fields whose text moves when the installed bytes move. */
const IDENTIFYING = new Set(['version', 'resolved', 'integrity']);

/** `version "7.24.7"` and `"@babel/highlight" "^7.24.7"` — space, not colon. */
function fieldOf(body: string): { readonly key: string; readonly value: string } | undefined {
  if (body.startsWith('"')) {
    const end = body.indexOf('"', 1);
    if (end === -1) return undefined;
    return { key: body.slice(1, end), value: unquoted(body.slice(end + 1).trim()) };
  }

  const space = body.indexOf(' ');
  if (space === -1) return undefined;
  return { key: body.slice(0, space), value: unquoted(body.slice(space + 1).trim()) };
}
