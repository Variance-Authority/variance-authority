import { describe, expect, it } from 'vitest';
import { importTargets, landing } from './entry.js';
import { requested } from './manifest.js';

/**
 * Where an import between packages lands, the one rule both usage readers
 * follow: the TypeScript walk and the join over the scan's parses.
 */

const TARGETS = importTargets([
  { name: '@acme/lib', main: 'dist/index.js' },
  { name: '@acme/kit' },
  { name: '@acme/app', private: true, main: 'src/index.ts' },
]);
const OPENED = new Set([requested('@acme/lib')]);

describe('where an import between packages lands', () => {
  it('names a specifier an entry opens, a file past a declared entry, and a file of a package that declares none', () => {
    expect(landing(requested('@acme/lib'), OPENED, TARGETS)).toBe('opened');
    expect(landing(requested('@acme/lib/src/internal'), OPENED, TARGETS)).toBe('deep');
    expect(landing(requested('@acme/kit/src/money'), OPENED, TARGETS)).toBe('byPath');
  });

  it('follows no import into a private package that declares an entry, nor into anything outside the workspace', () => {
    expect(landing(requested('@acme/app/src/screen'), OPENED, TARGETS)).toBeUndefined();
    expect(landing(requested('react'), OPENED, TARGETS)).toBeUndefined();
  });

  it('names an entry the manifest declares and the reading could not follow to a file, and keeps a file past it deep', () => {
    expect(landing(requested('@acme/lib'), new Set(), TARGETS)).toBe('unfollowed');
    expect(landing(requested('@acme/lib/src/internal'), new Set(), TARGETS)).toBe('deep');
  });
});

describe('which specifiers a manifest declares, followed or not', () => {
  // TanStack's `@tanstack/angular-query-experimental/devtools` names its types in
  // `./dist/`, which no `outDir` builds, so the subpath is declared and unread.
  const angular = {
    name: '@scope/angular',
    exports: { '.': './src/index.ts', './devtools': { types: './dist/devtools.d.mts' }, './locales/*': './src/locales/*', './locales/internal': null },
  };
  const { declared } = importTargets([angular, { name: 'legacy', typings: 'index.d.ts' }, { name: 'mixed', exports: { '.': './a.js', import: './b.js' } }]);

  it('is every subpath `exports` names with a target, and the bare name of a manifest that writes `main`, `types` or `typings`', () => {
    expect(declared.has(requested('@scope/angular/devtools'))).toBe(true);
    expect(declared.has(requested('@scope/angular'))).toBe(true);
    expect(declared.has(requested('legacy'))).toBe(true);
  });

  it('is not a specifier only a pattern matches, since every file a pattern matches is opened', () => {
    // MUI's `@mui/lab/Alert` matches `./*` and names a directory that was deleted.
    expect(declared.has(requested('@scope/angular/locales/gone.js'))).toBe(false);
  });

  it('is not a subpath `exports` closes with `null`, nor one it leaves out', () => {
    expect(declared.has(requested('@scope/angular/locales/internal'))).toBe(false);
    expect(declared.has(requested('@scope/angular/src/index.ts'))).toBe(false);
  });

  it('is nothing of an `exports` Node refuses to load', () => {
    expect([...declared].filter((key) => key.startsWith('mixed '))).toEqual([]);
  });
});

describe('a manifest that writes `exports: null`', () => {
  // Node consults `exports` only when it is neither `null` nor `undefined`, and
  // otherwise loads `main`, so `null` reads exactly as no `exports` at all.
  const { declared, unentered } = importTargets([{ name: 'nulled', exports: null, main: 'index.js' }, { name: 'bare', exports: null }]);

  it('declares the bare name `main` names', () => {
    expect(declared.has(requested('nulled'))).toBe(true);
    expect(unentered.has('nulled')).toBe(false);
  });

  it('declares no entry when it writes none of `main`, `types` or `typings`', () => {
    expect(unentered.has('bare')).toBe(true);
  });
});
