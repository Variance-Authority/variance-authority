/**
 * `pnpm-lock.yaml`, version 9.
 *
 * Two sections carry the answer and a third is deliberately unread. `packages:`
 * holds one entry per resolution, keyed `name@version`, and that key plus its
 * integrity is the identity. `snapshots:` holds the same keys with the peer
 * combination appended — `vite@5.4.0(@types/node@20.14.9)` — and it is where the
 * dependencies live. `importers:` is the workspace, and belongs to the file
 * graph rather than to this one.
 */

import { Packages, packageNameOf, withoutPeers, type Lockfile } from './lockfile.js';
import { mapAt, readYaml, textAt, Unreadable, unquoted, type YamlMap } from './yaml.js';

export function readPnpm(text: string): Lockfile {
  const root = readYaml(text);
  const version = unquoted(textAt(root, 'lockfileVersion') ?? '');

  // Only the major is checked. pnpm writes `'9.0'` and has bumped the minor for
  // additive fields; a section this reader does not look at is not a reason to
  // run a whole suite.
  if (!version.startsWith('9')) {
    throw new Unreadable(
      `pnpm-lock.yaml declares lockfileVersion ${version === '' ? '(absent)' : version}, and ` +
        'this reader reads 9',
    );
  }

  const packages = new Packages();
  const resolutions = mapAt(root, 'packages') ?? new Map();

  for (const [key, entry] of resolutions) {
    const identity = typeof entry === 'string' ? entry : identityOf(entry);
    packages.add(packageNameOf(withoutPeers(unslashed(key))), `${unslashed(key)} ${identity}`);
  }

  // Version 6 kept the dependencies beside the resolutions instead of in their
  // own section. Reading whichever is present costs one `??` and means the shape
  // decides rather than the number.
  const snapshots = mapAt(root, 'snapshots') ?? resolutions;

  for (const [key, entry] of snapshots) {
    if (typeof entry === 'string') continue;
    const name = packageNameOf(withoutPeers(unslashed(key)));

    for (const section of ['dependencies', 'optionalDependencies']) {
      const on = mapAt(entry, section);
      if (on === undefined) continue;
      for (const to of on.keys()) packages.depend(name, packageNameOf(withoutPeers(to)));
    }
  }

  return packages.done('pnpm');
}

/**
 * `resolution: {integrity: sha512-…}` arrives as the raw text of its line, which
 * is exactly what an identity wants: compared, never parsed.
 */
function identityOf(entry: YamlMap): string {
  const resolution = entry.get('resolution');
  return typeof resolution === 'string' ? resolution : '';
}

/** Version 6 wrote `/foo@1.0.0`; version 9 writes `foo@1.0.0`. */
function unslashed(key: string): string {
  return key.startsWith('/') ? key.slice(1) : key;
}
