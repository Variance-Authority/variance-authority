import { describe, expect, it } from 'vitest';
import { publishes } from './exports.js';
import { assembleHelp } from './help.js';
import type { Offering } from './manifest.js';

/** An offering that declares `exports` and opened none of it. */
function declaring(name: string, exports: unknown): Offering {
  return { name, dir: `/repo/${name}`, manifest: `/repo/${name}/package.json`, declared: { exports }, entrypoints: [] } as unknown as Offering;
}

describe('which specifiers a package publishes, opened or not', () => {
  // TanStack's `@tanstack/angular-query-experimental/devtools` names its types in
  // `./dist/`, which no `outDir` builds, so the subpath is declared and unread.
  const angular = declaring('@scope/angular', {
    '.': './src/index.ts',
    './devtools': { types: './dist/devtools.d.mts' },
    './locales/*': './src/locales/*',
    './locales/internal': null,
  });

  it('is a subpath the manifest names', () => {
    expect(publishes([angular], '@scope/angular/devtools')).toBe(true);
    expect(publishes([angular], '@scope/angular')).toBe(true);
  });

  it('is not a specifier only a pattern matches, since every file a pattern matches is opened', () => {
    // MUI's `@mui/lab/Alert` matches `./*` and names a directory that was deleted.
    expect(publishes([angular], '@scope/angular/locales/gone.js')).toBe(false);
  });

  it('is not a subpath the manifest closes with `null`', () => {
    expect(publishes([angular], '@scope/angular/locales/internal')).toBe(false);
  });

  it('is not a subpath the manifest leaves out, nor a package that is not here', () => {
    expect(publishes([angular], '@scope/angular/src/index.ts')).toBe(false);
    expect(publishes([angular], '@scope/react')).toBe(false);
  });

  it('keeps an import of a declared subpath out of the imports reported as reaching past one', () => {
    const deep = [
      { specifier: '@scope/angular/devtools', by: 'example', at: 'example/app.ts', line: 1 },
      { specifier: '@scope/angular/src/index.ts', by: 'example', at: 'example/app.ts', line: 2 },
    ];
    const help = assembleHelp('/repo', [angular], { names: new Map(), deep, exported: [], unreadable: [] }, () => new Map());
    expect(help.deep.map((held) => held.specifier)).toEqual(['@scope/angular/src/index.ts']);
  });
});
