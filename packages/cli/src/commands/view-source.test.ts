import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAY, recordFixture } from './covering-record.fixture.js';
import { viewSources, SOURCE_FILES } from './view-source.js';

/**
 * The text of each source file the page holds, and the state `covering` gives
 * each recorded range of it: one answer, which the editor extension reads too.
 */
const fixture = recordFixture();

describe('the source files a view page holds', () => {
  it('carries a recorded file\'s text and the state of each of its ranges', async () => {
    const { at } = await fixture.checkout({ fee: true });

    const { files } = await viewSources(at, ['src/pay.ts']);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ file: 'src/pay.ts', text: PAY });
    expect(files[0]!.marks.length).toBeGreaterThan(0);
    expect(files[0]!.marks[0]).toMatchObject({ startLine: 1, endLine: 1, state: 'walked' });
    expect(files[0]).not.toHaveProperty('note');
  });

  it('carries no text and no range for a file the record lacks, and says so', async () => {
    const { at } = await fixture.checkout();
    await writeFile(join(at, 'src/lost.ts'), 'export const lost = 1;\n');

    const { files } = await viewSources(at, ['src/lost.ts', 'src/gone.ts']);

    for (const row of files) {
      expect(row).not.toHaveProperty('text');
      expect(row.marks).toEqual([]);
      expect(row.note).toEqual(expect.any(String));
    }
  });

  it('keeps the text and says no state is known where the record holds the file with no range state', async () => {
    const { at } = await fixture.checkout();

    const [row] = (await viewSources(at, ['src/pay.ts'])).files;

    expect(row).toMatchObject({ file: 'src/pay.ts', text: PAY, marks: [] });
    expect(row!.note).toEqual(expect.any(String));
  });

  it('holds the text of at most SOURCE_FILES files, and says how many it left out', async () => {
    const { at } = await fixture.checkout();
    const many = Array.from({ length: SOURCE_FILES + 3 }, () => 'src/pay.ts');

    const read = await viewSources(at, many);

    expect(read.files).toHaveLength(SOURCE_FILES);
    expect(read.left).toBe(3);
  });
});
