import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanRelations } from './scan.js';

/**
 * Seeding the harness, which lives where no component scan would look.
 *
 * A `vitest.config.ts` sits above every directory anybody points `dirs` at, so
 * a walk from those seeds never reaches it and the graph has no node for the
 * file that decides how the whole suite runs. Named here it becomes an ordinary
 * node, and so does everything it loads.
 */
describe('files a run rests on, seeded by name', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-before-'));
    await write(root, 'vitest.config.ts', "import './test/setup.js';\nexport default {};");
    await write(root, 'test/setup.ts', "import '../src/theme.js';\nexport const setup = 1;");
    await write(root, 'src/theme.ts', 'export const theme = 1;');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is absent from a scan that was only given directories', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });

    expect(records.map((record) => record.file)).toEqual(['src/theme.ts']);
  });

  it('enters the graph with what it loads when it is named', async () => {
    const records = await scanRelations({ root, dirs: ['src'], before: ['vitest.config.ts'] });
    const files = records.map((record) => record.file).sort();

    expect(files).toEqual(['src/theme.ts', 'test/setup.ts', 'vitest.config.ts']);
    expect(records.find((record) => record.file === 'vitest.config.ts')?.edges).toEqual([
      { to: 'test/setup.ts', kind: 'imports' },
    ]);
  });

  it('drops a path that is not there rather than recording it unreadable', async () => {
    // An unknown file is a seed of every walk forever, so a misspelled entry
    // recorded that way would widen every run in the repository and read, in
    // the report, as a scan that had failed.
    const records = await scanRelations({
      root,
      dirs: ['src'],
      before: ['vitest.confg.ts', 'vitest.config.ts'],
    });

    expect(records.map((record) => record.file)).not.toContain('vitest.confg.ts');
    expect(records.some((record) => record.unknown !== undefined)).toBe(false);
  });

  it('drops a path it has no reader for, such as a `.nvmrc`', async () => {
    await write(root, '.nvmrc', '24');
    const records = await scanRelations({ root, dirs: ['src'], before: ['.nvmrc'] });

    expect(records.map((record) => record.file)).toEqual(['src/theme.ts']);
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
