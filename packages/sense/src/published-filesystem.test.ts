import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { native } from './addon.js';
import { BadLogPath } from './immutable-log.js';
import { readPublishedSources, updateSourceIndex } from './test-support/published.js';

it.each(['', { file: 'index.bin' }])('refuses an invalid native publication path %j before listing source', async (index) => {
  const listing = vi.spyOn(native()!, 'changeTree');
  try {
    await expect(updateSourceIndex('/invalid-index-fixture', { index: index as string }))
      .rejects.toBeInstanceOf(BadLogPath);
    expect(listing).not.toHaveBeenCalled();
  } finally {
    listing.mockRestore();
  }
});

it('publishes and updates source outside Git through the native lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'variance-filesystem-'));
  const index = join(root, '.cache', 'source-index.bin');
  const languageReads = vi.spyOn(native()!, 'readLanguage').mockImplementation(() => {
    throw new Error('per-file language bridge entered');
  });
  const write = async (file: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  };
  const edges = async (file: string): Promise<readonly string[]> =>
    (await readPublishedSources(index)).records.find((record) => record.file === file)?.edges?.map((edge) => edge.to) ?? [];
  try {
    await write('package.json', '{"name":"plain-directory"}');
    await write('tsconfig.json', '{"compilerOptions":{"paths":{"@shared/*":["./shared/*"]}}}');
    await write('web/index.ts', "import { value } from '@shared/value';\nexport { value };\n");
    await write('shared/value.ts', 'export const value = 1;\n');
    await write('rs/Cargo.toml', '[package]\nname = "plain-directory"\nversion = "0.1.0"\n');
    await write('rs/src/lib.rs', 'mod child;\n');
    await write('rs/src/child.rs', 'pub fn call() {}\n');
    await write('node_modules/ignored/index.ts', 'export const ignored = 1;\n');

    const first = await updateSourceIndex(root, { index, dirs: ['web', 'rs'] });
    expect(first).toMatchObject({ was: 'missing', files: 4, reread: 4 });
    expect(first.listing?.filesystem).toBe(true);
    expect(first.listing?.has('package.json')).toBe(true);
    expect(first.listing?.has('shared/value.ts')).toBe(true);
    expect(first.listing?.has('node_modules/ignored/index.ts')).toBe(false);
    expect(await edges('web/index.ts')).toContain('shared/value.ts');
    expect(await edges('rs/src/lib.rs')).toContain('rs/src/child.rs');

    await write('shared/next.ts', 'export const value = 2;\n');
    await write('web/index.ts', "import { value } from '@shared/next';\nexport { value };\n");
    await expect(updateSourceIndex(root, { index, dirs: ['web', 'rs'] }))
      .resolves.toMatchObject({ was: 'published', files: 4 });
    expect(new Set(await edges('web/index.ts'))).toEqual(new Set(['shared/next.ts']));
    expect((await readPublishedSources(index)).records.map((record) => record.file))
      .not.toContain('shared/value.ts');
    expect(languageReads).not.toHaveBeenCalled();
  } finally {
    languageReads.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
