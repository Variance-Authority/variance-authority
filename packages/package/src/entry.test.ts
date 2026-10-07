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
});
