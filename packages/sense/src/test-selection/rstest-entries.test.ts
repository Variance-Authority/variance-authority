import { describe, expect, it } from 'vitest';

import { buildsTestFile } from './rstest-entries.js';

describe('buildsTestFile', () => {
  it('reads a loaded file Rspack spells with forward slashes as the same file on Windows', () => {
    expect(buildsTestFile({ setup: 'C:/repo/setup.ts' }, new Set(['C:\\repo\\setup.ts']))).toBe(false);
  });

  it('reads a file no loaded file names as a test file', () => {
    expect(buildsTestFile({ setup: 'C:/repo/setup.ts', a: 'C:/repo/a.test.ts' }, new Set(['C:\\repo\\setup.ts']))).toBe(true);
  });

  const LOADED = new Set(['/repo/setup.ts']);

  it.each<[string, unknown]>([
    ['a path', '/repo/a.test.ts'],
    ['a list of paths', ['/repo/setup.ts', '/repo/a.test.ts']],
    ['a list under a name', { main: ['/repo/setup.ts', '/repo/a.test.ts'] }],
    ['a description', { main: { import: '/repo/a.test.ts' } }],
    ['a description of a list', { main: { import: ['/repo/setup.ts', '/repo/a.test.ts'], runtime: 'main' } }],
  ])('reads a test file in %s', (_shape, entry) => {
    expect(buildsTestFile(entry, LOADED)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a path', '/repo/setup.ts'],
    ['a list of paths', ['/repo/setup.ts']],
    ['a list under a name', { main: ['/repo/setup.ts'] }],
    ['a description', { main: { import: '/repo/setup.ts', runtime: 'main' } }],
    ['a description of a list', { main: { import: ['/repo/setup.ts'] } }],
    ['nothing', undefined],
  ])('reads no test file in %s of what is loaded', (_shape, entry) => {
    expect(buildsTestFile(entry, LOADED)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a description with no import', { main: { runtime: 'main' } }],
    ['a value it does not know', { main: 1 }],
  ])('takes %s to hold a test file, as it cannot say none is there', (_shape, entry) => {
    expect(buildsTestFile(entry, LOADED)).toBe(true);
  });
});
