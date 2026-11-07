import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestSelection as withJest } from './jest.js';
import { refuseUnreadable } from './precondition-entries.js';
import { withTestSelection as withRstest } from './rstest.js';
import { withTestSelection as withVitest } from './vitest.js';

/**
 * An entry in `preconditions` is read when the run ends, and one that cannot be
 * read as a file fails a run whose tests all passed. The refusal reads the disk,
 * not the entry's spelling, and it reads it when a run starts: wrapping a
 * configuration happens for every command that loads it.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-precondition-entries-'));
  await mkdir(resolve(root, 'src'));
  await writeFile(resolve(root, 'src/a.ts'), 'export {};\n');
  await writeFile(resolve(root, 'tsconfig.json'), '{}\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const refusing = (entries: readonly string[]) => () => refuseUnreadable(entries.map((entry) => resolve(root, entry)));

describe('refuseUnreadable', () => {
  it('passes a file that reads', () => {
    expect(refusing(['tsconfig.json', 'src/a.ts'])).not.toThrow();
  });

  it('passes nothing declared', () => {
    expect(refusing([])).not.toThrow();
  });

  it('passes what digests though it is no regular file', () => {
    expect(() => refuseUnreadable(['/dev/null'])).not.toThrow();
  });

  it('refuses a glob, by the path it resolved to', () => {
    expect(refusing(['tsconfig.json', 'src/**/*.ts'])).toThrow(`names ${resolve(root, 'src/**/*.ts')}, which`);
  });

  it('refuses a directory', () => {
    expect(refusing(['src'])).toThrow(`names ${resolve(root, 'src')}, which`);
  });

  it('refuses a missing path, and says what a precondition is', () => {
    expect(refusing(['generated.json'])).toThrow(/cannot be read as a file.*Each entry is the path of one file.*a file a test writes during the run is not a precondition/s);
  });

  it.skipIf(process.getuid?.() === 0)('refuses a file it has no permission to read', async () => {
    await writeFile(resolve(root, 'sealed.json'), '{}\n');
    await chmod(resolve(root, 'sealed.json'), 0o000);

    expect(refusing(['sealed.json'])).toThrow('sealed.json');
  });

  it('names every entry it refuses', () => {
    expect(refusing(['tsconfig.json', 'src', 'generated.json'])).toThrow(`names ${resolve(root, 'src')}, ${resolve(root, 'generated.json')}, which`);
  });

  it('lets a missing addon through, which says nothing of any file', async () => {
    vi.resetModules();
    vi.doMock('../addon.js', () => ({ native: () => undefined, nativeRefusal: () => 'which did not load' }));
    const { refuseUnreadable: withoutAddon } = await import('./precondition-entries.js');
    vi.doUnmock('../addon.js');

    expect(() => withoutAddon([resolve(root, 'tsconfig.json')])).toThrow('digested by the native addon, which did not load');
  });
});

const seams: Readonly<Record<string, (preconditions: readonly string[]) => unknown>> = {
  'Jest withTestSelection': (preconditions) => withJest({ rootDir: root }, { coverageFile: 'coverage.bin', preconditions }),
  'Vitest withTestSelection': (preconditions) =>
    withVitest({}, { root, coverageFile: resolve(root, 'coverage.bin'), preconditions, include: () => false }),
  'Rstest withTestSelection': (preconditions) =>
    withRstest({ root }, { coverageFile: resolve(root, 'coverage.bin'), preconditions, include: () => false }),
};

describe.each(Object.keys(seams))('%s', (name) => {
  it('does not read an entry when it wraps the configuration', () => {
    expect(() => seams[name]!(['src/**/*.ts', 'src', 'generated.json'])).not.toThrow();
  });
});
