/**
 * `pnpm-lock.yaml`, version 9.
 *
 * Two sections carry the answer and a third is deliberately unread. `packages:`
 * holds one entry per resolution, keyed `name@version`, and that key plus its
 * integrity is the identity. `snapshots:` holds the same keys with the peer
 * combination appended — `vite@5.4.0(@types/node@20.14.9)` — and it is where the
 * dependencies live. `importers:` is the workspace, and belongs to the file
 * graph rather than to this one.
 *
 * A pnpm that pins itself writes the file as two YAML documents, and the split
 * is pnpm's own (`lockfile/fs`, `yamlDocuments`): a file that opens on `---`
 * holds an **environment** document up to the first `\n---\n`, and the lockfile
 * of the install after it. The environment is a lockfile of the same version
 * and shape whose one importer lists `configDependencies` and
 * `packageManagerDependencies` — pnpm itself and what its configuration loads.
 * Both are read into one answer: a package the environment installs is a
 * package that moved when it moves, and no source file importing it means it
 * selects nothing, which is the true answer rather than a silent one.
 */

import { Packages, packageNameOf, withoutPeers, type Lockfile } from './lockfile.js';
import { mapAt, readYaml, textAt, Unreadable, unquoted, type YamlMap } from './yaml.js';

/** pnpm's own markers: a file opening on the first, and the one between two documents. */
const DOCUMENT_START = '---\n';
const DOCUMENT_SEPARATOR = '\n---\n';

export function readPnpm(text: string): Lockfile {
  const packages = new Packages();

  for (const document of documentsOf(text)) {
    readDocument(readYaml(document.text, document.firstLine), document.name, packages);
  }

  return packages.done('pnpm');
}

interface Document {
  /** How a refusal names it. */
  readonly name: string;
  readonly text: string;
  /** The line of the file its text starts on. */
  readonly firstLine: number;
}

/**
 * The documents of the file, the way pnpm splits them: the byte order mark and
 * CRLF line ends a Windows checkout adds are dropped first, as pnpm drops them.
 */
function documentsOf(raw: string): readonly Document[] {
  const text = (raw.startsWith('﻿') ? raw.slice(1) : raw).replaceAll('\r\n', '\n');
  if (!text.startsWith(DOCUMENT_START)) return [{ name: 'pnpm-lock.yaml', text, firstLine: 1 }];

  const separator = text.indexOf(DOCUMENT_SEPARATOR, DOCUMENT_START.length);
  if (separator === -1) {
    // pnpm reads this as a project with no lockfile at all, so there is no
    // install here to compare.
    throw new Unreadable('pnpm-lock.yaml holds no lockfile after its environment document');
  }

  const environment = text.slice(DOCUMENT_START.length, separator);
  const install = text.slice(separator + DOCUMENT_SEPARATOR.length);
  return [
    { name: "pnpm-lock.yaml's environment document", text: environment, firstLine: 2 },
    { name: 'pnpm-lock.yaml', text: install, firstLine: 4 + lineCount(environment) },
  ];
}

function lineCount(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
  return count;
}

function readDocument(root: YamlMap, name: string, packages: Packages): void {
  const version = unquoted(textAt(root, 'lockfileVersion') ?? '');

  // Only the major is checked. pnpm writes `'9.0'` and has bumped the minor for
  // additive fields; a section this reader does not look at is not a reason to
  // run a whole suite.
  if (!version.startsWith('9')) {
    throw new Unreadable(
      `${name} declares lockfileVersion ${version === '' ? '(absent)' : version}, and ` +
        'this reader reads 9',
    );
  }

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
