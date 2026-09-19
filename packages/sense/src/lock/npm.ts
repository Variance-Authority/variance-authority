/**
 * `package-lock.json` and `npm-shrinkwrap.json`, versions 2 and 3.
 *
 * One map, `packages`, keyed by install path. The path is the answer to a
 * question no other format makes you ask — what npm calls a package is where it
 * put it, and two entries can be the same name at two depths — so the name is
 * read back off the last `node_modules/` segment, which is what an importer at
 * that depth would resolve.
 *
 * Version 2 also carries the version-1 `dependencies` tree for old clients. It
 * is ignored: it is a second copy of the same install, and reading both would
 * only be a way to disagree with oneself.
 */

import { Packages, type Lockfile } from './lockfile.js';
import { Unreadable } from './yaml.js';

export function readNpm(text: string): Lockfile {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    throw new Unreadable(`package-lock.json is not JSON: ${(error as Error).message}`);
  }

  const document = asObject(root) ?? {};
  const version = document['lockfileVersion'];

  if (version !== 2 && version !== 3) {
    throw new Unreadable(
      `package-lock.json declares lockfileVersion ${JSON.stringify(version)}, and this reader ` +
        'reads 2 and 3',
    );
  }

  const entries = asObject(document['packages']);
  if (entries === undefined) {
    throw new Unreadable('package-lock.json has no `packages` map to read');
  }

  const packages = new Packages();

  for (const [path, value] of Object.entries(entries)) {
    const entry = asObject(value);
    if (entry === undefined) continue;

    // The root (`""`) and every workspace are keyed by a path with no
    // `node_modules` in it; a workspace symlinked into place carries
    // `link: true`. Both are our own source.
    const name = installedName(path);
    if (name === undefined || entry['link'] === true) continue;

    packages.add(name, [entry['version'], entry['resolved'], entry['integrity']].join(' '));

    for (const section of ['dependencies', 'optionalDependencies']) {
      const on = asObject(entry[section]);
      if (on === undefined) continue;
      for (const to of Object.keys(on)) packages.depend(name, to);
    }
  }

  return packages.done('npm');
}

function installedName(path: string): string | undefined {
  const at = path.lastIndexOf('node_modules/');
  if (at === -1) return undefined;
  const name = path.slice(at + 'node_modules/'.length);
  return name === '' ? undefined : name;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
