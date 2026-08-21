import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countNames, readSurface } from './surface.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

describe('what a workspace publishes', () => {
  const surface = readSurface(WORKSPACE);

  it('is one entry per package that says it may be published', () => {
    expect(Object.keys(surface).sort()).toEqual(['alpha', 'beta', 'solo']);
  });

  it('carries what each manifest declares, verbatim', () => {
    expect(surface['solo']?.declared['sideEffects']).toBe(false);
  });

  it('carries every name each subpath opens, by subpath', () => {
    expect(Object.keys(surface['alpha']?.names ?? {})).toEqual(['.', './widget', './direct']);
    expect(surface['alpha']?.names['./widget']).toEqual({ Widget: 'function' });
  });

  it('says in one word what each name is', () => {
    expect(surface['beta']?.names['.']).toEqual({
      "* from 'node:path'": 'foreign',
      Shape: 'interface',
      already: 'const',
      default: 'object',
      measure: 'function',
      readFileSync: 'foreign',
    });
  });

  it('reads the same workspace the same way twice', () => {
    expect(readSurface(WORKSPACE)).toEqual(surface);
  });

  it('records only the manifest keys an option asks for', () => {
    const narrow = readSurface(WORKSPACE, { offered: ['type'] });
    expect(narrow['beta']?.declared).toEqual({ type: 'module' });
    expect(narrow['beta']?.names).toEqual(surface['beta']?.names);
  });
});

describe('how many names a surface holds', () => {
  it('is the number that would drop to nothing if the reading stopped working', () => {
    // The interesting failure of a reader like this is not a wrong answer but
    // an empty one, and a baseline re-recorded from nothing agrees with it.
    expect(countNames(readSurface(WORKSPACE))).toBe(24);
    expect(countNames({})).toBe(0);
  });
});
