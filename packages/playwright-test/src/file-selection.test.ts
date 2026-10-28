import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkippedFiles, fileSelection, keptFiles, selectFiles } from './file-selection.js';

describe('the testIgnore pattern a selection drops by', () => {
  const root = resolve('/repo');
  const read = async () => ({ whole: new Set(['tests/a.spec.ts', 'tests/b.spec.ts']), skip: new Set(['tests/b.spec.ts']), notes: [] });

  it('drops nothing before the selection is read, as under --list', () => {
    selectFiles(root, read);
    expect(new SkippedFiles().test(resolve(root, 'tests/b.spec.ts'))).toBe(false);
  });

  it('drops the files the selection skips, by the name the selection gives them, and remembers them', async () => {
    selectFiles(root, read);
    fileSelection()!.selection = await read();
    const drop = new SkippedFiles();

    expect(drop.test(resolve(root, 'tests/a.spec.ts'))).toBe(false);
    expect(drop.test(resolve(root, 'tests/b.spec.ts'))).toBe(true);
    expect(fileSelection()!.dropped).toEqual(new Set(['tests/b.spec.ts']));
  });

  it('keeps the spec files it let through that a project matches, and not the helpers beside them', async () => {
    selectFiles(root, read);
    fileSelection()!.selection = await read();
    const drop = new SkippedFiles();
    for (const file of ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/helpers.ts']) drop.test(resolve(root, file));

    expect(keptFiles(fileSelection()!, ['**/*.spec.ts'])).toEqual(['tests/a.spec.ts']);
    expect(keptFiles(fileSelection()!, [/never/u])).toEqual([]);
  });

  it('matches nothing once Playwright copies it by its source', () => {
    const copy = new RegExp(new SkippedFiles().source, new SkippedFiles().flags);
    expect(copy.test('/repo/tests/b.spec.ts')).toBe(false);
  });
});
