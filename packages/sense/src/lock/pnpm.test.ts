import { describe, expect, it } from 'vitest';
import { changedPackages, packageRelations, readLockfile } from './index.js';

/**
 * A `pnpm-lock.yaml` written by a pnpm that pins itself, in TanStack Query's
 * shape: two YAML documents. The first is pnpm's environment — the package
 * manager `packageManagerDependencies` records, and any `configDependencies` —
 * and the second is the lockfile of the install under `node_modules`. The
 * header and the entries are copied from TanStack Query's own lockfile, cut to
 * one devtools dependency and what it rests on.
 */
const TANSTACK = `---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.4.2
        version: 12.4.2

packages:

  '@pnpm/exe.darwin-arm64@12.4.2':
    resolution: {integrity: sha512-A0WDo8iErfZBXgrLseQxw8i8Y9ctUpOEl/Uu+cubnTzpD8tT9ykIB548L8YTM2WD4OS+ZOHSxy8aGZcvKq8PaQ==}
    cpu: [arm64]
    os: [darwin]

  pnpm@12.4.2:
    resolution: {integrity: sha512-CK3GYTGAJ1x8ntraOdzwjJxhrU5+rzMKTzRh8QKw+QdCNFTRF/mOctR/7wYWBwZE17/8lzpqV/UJCm18NosHyQ==}
    engines: {node: '>=18.*'}
    hasBin: true

snapshots:

  '@pnpm/exe.darwin-arm64@12.4.2':
    optional: true

  pnpm@12.4.2:
    optionalDependencies:
      '@pnpm/exe.darwin-arm64': 12.4.2

---
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

catalogs:
  default:
    '@analogjs/vite-plugin-angular':
      specifier: ^2.7.5
      version: 2.7.5

overrides:
  chokidar: 5.0.0
  '@types/react': ^19.2.7

importers:

  packages/query-devtools:
    dependencies:
      '@solid-primitives/keyed':
        specifier: ^1.5.3
        version: 1.5.3(solid-js@1.9.15)
      '@tanstack/match-sorter-utils':
        specifier: ^9.1.2
        version: 9.1.2

packages:

  '@solid-primitives/keyed@1.5.3':
    resolution: {integrity: sha512-zNadtyYBhJSOjXtogkGHmRxjGdz9KHc8sGGVAGlUABkE8BED2tbIZoxkwSqzOwde8OcUEH0bb5DLZUWIMvyBSA==}
    peerDependencies:
      solid-js: ^1.6.12

  '@tanstack/match-sorter-utils@9.1.2':
    resolution: {integrity: sha512-aPkUQctDzpXLSWhlx7jUDi3mInsI18xcnrK1hvIyIa88ab1ax88cACr7xU+BKMCGB4NZYNwh4SoNSEbv3RY2NA==}
    engines: {node: '>=20'}

  remove-accents@0.5.0:
    resolution: {integrity: sha512-8g3/Otx1eJaVD12e31UbJj1YzdtVvzH85HV7t+9MJYk/u3XmkOUJ5Ys9wQrf9PCPK8+xn4ymzqYCiZl6QWKn+A==}

  solid-js@1.9.15:
    resolution: {integrity: sha512-EeiY2xfpZJqPLjXspVEKjAII4yv8NyG//NxZ3IpOFHdUNnnTyL0uJOeS9LWGvA7cFCz5y94cjFwYlmw5Luncsg==}

snapshots:

  '@solid-primitives/keyed@1.5.3(solid-js@1.9.15)':
    dependencies:
      solid-js: 1.9.15

  '@tanstack/match-sorter-utils@9.1.2':
    dependencies:
      remove-accents: 0.5.0

  remove-accents@0.5.0: {}

  solid-js@1.9.15: {}
`;

/** The same install with `remove-accents` moved from 0.5.0 to 0.5.1. */
const BUMPED = TANSTACK.replaceAll('remove-accents@0.5.0', 'remove-accents@0.5.1')
  .replace('remove-accents: 0.5.0', 'remove-accents: 0.5.1')
  .replace('sha512-8g3/Otx1eJaVD12e31', 'sha512-9h4/Otx1eJaVD12e31');

describe('a pnpm-lock.yaml that opens on its environment document', () => {
  it('compares the install', () => {
    const lock = readLockfile('pnpm-lock.yaml', TANSTACK);

    expect(lock.format).toBe('pnpm');
    expect(lock.identities.get('remove-accents')).toContain('remove-accents@0.5.0');
    expect(changedPackages(lock, readLockfile('pnpm-lock.yaml', TANSTACK))).toEqual([]);
  });

  it('moves only the bumped package, and carries it to the packages resting on it', () => {
    const before = readLockfile('pnpm-lock.yaml', TANSTACK);
    const after = readLockfile('pnpm-lock.yaml', BUMPED);

    expect(changedPackages(before, after)).toEqual(['remove-accents']);
    const dependents = packageRelations(after)
      .filter(([, to]) => to === 'remove-accents')
      .map(([from]) => from);
    expect(dependents).toEqual(['@tanstack/match-sorter-utils']);
  });

  it('reads the package manager the environment document pins', () => {
    // pnpm is installed from the first document, never into `node_modules`; a
    // bump of it is a package that moved, and one no source file imports.
    const before = readLockfile('pnpm-lock.yaml', TANSTACK);
    const after = readLockfile('pnpm-lock.yaml', TANSTACK.replaceAll('12.4.2', '12.4.3'));

    expect(before.identities.get('pnpm')).toContain('pnpm@12.4.2');
    expect(changedPackages(before, after)).toEqual(['@pnpm/exe.darwin-arm64', 'pnpm']);
  });

  it('reads the file a Windows checkout writes, with a byte order mark and CRLF', () => {
    const before = readLockfile('pnpm-lock.yaml', TANSTACK);
    const windows = readLockfile('pnpm-lock.yaml', `﻿${TANSTACK.replaceAll('\n', '\r\n')}`);

    expect(changedPackages(before, windows)).toEqual([]);
  });

  it('names the document an unreadable line sits in, at its line in the file', () => {
    const broken = TANSTACK.replace('  solid-js@1.9.15: {}', '  solid-js@1.9.15: &anchor');
    const line = broken.split('\n').indexOf('  solid-js@1.9.15: &anchor') + 1;

    expect(() => readLockfile('pnpm-lock.yaml', broken)).toThrow(`line ${line}:`);
  });

  it('refuses an environment document with no lockfile after it', () => {
    // pnpm itself reads this as a project with no lockfile, so there is no
    // install to compare.
    const alone = TANSTACK.slice(0, TANSTACK.indexOf('\n---\n') + 1);

    expect(() => readLockfile('pnpm-lock.yaml', alone)).toThrow(/no lockfile after its environment document/);
  });
});
