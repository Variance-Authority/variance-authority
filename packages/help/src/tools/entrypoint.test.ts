import { describe, expect, it } from 'vitest';
import { BY_PATH, QUIET, SUBPATHS_ONLY, busier } from '../__fixtures__/imported-by-path.js';
import { entrypoint } from './entrypoint.js';

/**
 * `docs_entrypoint` on a package other packages import by path: the question
 * that counts per file, then lists for one file, the import sites behind what
 * `docs_packages` counts. What one published specifier opens is in
 * `help.test.ts`.
 */

describe('docs_entrypoint on a package other packages import by path', () => {
  it('counts what other packages import from a package that declares no entry per file, its own imports left out', () => {
    const text = entrypoint.run(BY_PATH, { package: '@acme/kit' });

    expect(text).toMatch(
      /^@acme\/kit declares no entry: no `exports`, `main` or `types`\. Other packages import 2 names from 2 of its files by path, most imported first:$/m,
    );
    expect(text).toContain('  @acme/kit/src/money/tax — 1 name, imported by 1 file');
    expect(text).toContain('  @acme/kit/src/ui/Button — 1 name, imported by 1 file');
    expect(entrypoint.run(BY_PATH, { package: '@acme/kit/src/money/tax' })).not.toContain('packages/kit/src/self.ts');
    expect(text).not.toContain('@acme/stamp');
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/kit\/src\/money\/tax$/m);
    expect(text).toMatch(/^ {2}variance ask uses --name taxOf --package @acme\/kit\/src\/money\/tax$/m);
  });

  it('takes one file of a package that declares no entry, unsplit or split, and answers the same', () => {
    const text = entrypoint.run(BY_PATH, { package: '@acme/kit/src/money/tax' });

    expect(text).toMatch(/^@acme\/kit declares no entry: .* Other packages import 1 name from @acme\/kit\/src\/money\/tax by path:$/m);
    expect(entrypoint.run(BY_PATH, { package: '@acme/kit', subpath: './src/money/tax' })).toBe(text);
  });

  it('counts the imports past the entry of a package that declares one per file, after the names its entry opens', () => {
    const text = entrypoint.run(BY_PATH, { package: '@acme/lib' });

    expect(text.startsWith('@acme/lib — 1 name\n')).toBe(true);
    expect(text).toMatch(/^2 imports reach past a published entrypoint of @acme\/lib\. .* By file, most imported first:$/m);
    expect(text.indexOf('greet [function]')).toBeLessThan(text.indexOf('imports reach past'));
    expect(text).toContain('  @acme/lib/src/internal/math — 1 name, imported by 1 file');
    expect(text).toContain('  @acme/lib/src/internal/format — 1 name, imported by 1 file');
  });

  it('puts the file the most files import first, and names its specifier and its most-taken name', () => {
    const text = entrypoint.run(SUBPATHS_ONLY, { package: '@acme/srv' });

    expect(text.indexOf('@acme/srv/src/routes — 1 name, imported by 2 files')).toBeLessThan(text.indexOf('@acme/srv/src/wire — 1 name, imported by 1 file'));
    expect(text).toMatch(/^ {2}variance ask uses --name route --package @acme\/srv\/src\/routes$/m);
  });

  it('names the specifier with the most imports past the entry, ties in code-unit order, then the first name', () => {
    const text = entrypoint.run(BY_PATH, { package: '@acme/lib' });
    const asks = text.slice(text.indexOf('Narrower questions:')).split('\n').slice(1);

    expect(asks).toEqual([
      '  variance ask entrypoint --package @acme/lib/src/internal/format',
      '  variance ask uses --name formatPrice --package @acme/lib/src/internal/format',
    ]);
    expect(entrypoint.run(SUBPATHS_ONLY, { package: '@acme/srv' })).toMatch(/^ {2}variance ask entrypoint --package @acme\/srv\/src\/routes$/m);
  });

  it('takes one specifier past the entry, unsplit or split, and answers for that specifier alone', () => {
    const text = entrypoint.run(BY_PATH, { package: '@acme/lib/src/internal/math' });

    expect(text).toMatch(/^1 import reaches past a published entrypoint of @acme\/lib\./m);
    expect(text).toContain('  @acme/lib/src/internal/math — @acme/app at apps/app/src/total.ts:1');
    expect(text).not.toContain('format');
    expect(entrypoint.run(BY_PATH, { package: '@acme/lib', subpath: './src/internal/math' })).toBe(text);
  });

  it('lists the specifiers a package opens when it opens no main entry, then the imports past them', () => {
    const text = entrypoint.run(SUBPATHS_ONLY, { package: '@acme/srv' });

    expect(text.split('\n')[0]).toBe('@acme/srv opens no main entry. It opens:');
    expect(text).toMatch(/^ {2}@acme\/srv\/server — 1 name, 1 imported elsewhere, 0 documented$/m);
    expect(text).toMatch(/^3 imports reach past a published entrypoint of @acme\/srv\./m);
    expect(text.indexOf('@acme/srv/server —')).toBeLessThan(text.indexOf('imports reach past'));
    expect(text).toMatch(/^ {2}variance ask entrypoint --package @acme\/srv\/server$/m);
  });

  it('answers `--subpath .` exactly as it answers the package name alone', () => {
    for (const [help, name] of [[BY_PATH, '@acme/lib'], [SUBPATHS_ONLY, '@acme/srv'], [QUIET, '@acme/quiet'], [BY_PATH, '@acme/kit']] as const) {
      expect(entrypoint.run(help, { package: name, subpath: '.' })).toBe(entrypoint.run(help, { package: name }));
    }
  });

  it('counts the sites per file asked by a package name, so many sites cost no lines, and its rows reach every site', () => {
    const many = busier(100);
    for (const name of ['@acme/kit', '@acme/lib']) {
      const text = entrypoint.run(many, { package: name });
      const rows = [...text.matchAll(/^ {2}(\S+) — \d+ names?, imported by \d+ files?$/gmu)].map((row) => row[1]!);
      const listed = rows.flatMap((specifier) => entrypoint.run(many, { package: specifier }).split('\n').filter((row) => / at \S+:\d+$/u.test(row)));

      expect(text.split('\n')).toHaveLength(entrypoint.run(BY_PATH, { package: name }).split('\n').length);
      expect(text).not.toMatch(/ at \S+:\d+$/mu);
      expect(rows).toHaveLength(2);
      expect(new Set(listed).size).toBe(202);
    }
  });

  it('says the counts are floors when a file could not be read', () => {
    const text = entrypoint.run({ ...BY_PATH, unreadable: ['apps/app/src/broken.ts'] }, { package: '@acme/lib' });

    expect(text).toMatch(/^1 file could not be read, so these imports are a floor; `variance ask packages` lists it\.$/m);
  });

  it('counts the imports past the entry of a package that opens none', () => {
    const text = entrypoint.run(QUIET, { package: '@acme/quiet' });

    expect(text).toMatch(/^@acme\/quiet opens no entry\.$/m);
    expect(text).toContain('  @acme/quiet/src/hush — 1 name, imported by 1 file');
    expect(entrypoint.run(QUIET, { package: '@acme/quiet/src/hush' })).toContain('  @acme/quiet/src/hush — @acme/app at apps/app/src/hushed.ts:1');
  });

  it('refuses a specifier nothing opens and nothing imports, saying which of the two its package lacks', () => {
    expect(() => entrypoint.run(QUIET, { package: '@acme/quiet/src/nowhere' })).toThrow(
      '`@acme/quiet/src/nowhere`: @acme/quiet opens no entry, and no other package imports this specifier',
    );
    expect(() => entrypoint.run(BY_PATH, { package: '@acme/lib/src/nowhere' })).toThrow(/does not open `\.\/src\/nowhere`; it opens: \.$/);
  });
});
