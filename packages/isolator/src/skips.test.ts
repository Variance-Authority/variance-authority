import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { skipper } from './skips.js';

/** A package at `dir` declaring `sideEffects` as given; `undefined` leaves the field out. */
const pack = (dir: string, sideEffects?: unknown): string => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(sideEffects === undefined ? { name: 'p' } : { name: 'p', sideEffects }));
  return dir;
};

describe('skipper: a package that declares side effects', () => {
  const root = mkdtempSync(join(tmpdir(), 'isolator-skips-'));

  it('leaves every module of a package whose sideEffects is true', () => {
    const dir = pack(join(root, 'effects'), true);
    expect(skipper(root)(join(dir, 'src/a.ts'))).toBe(true);
  });

  it('leaves the modules a sideEffects list names, and only those', () => {
    const dir = pack(join(root, 'listed'), ['./src/register.ts', '*.polyfill.js']);
    const skipped = skipper(root);
    expect(skipped(join(dir, 'src/register.ts'))).toBe(true);
    expect(skipped(join(dir, 'src/deep/fetch.polyfill.js'))).toBe(true);
    expect(skipped(join(dir, 'src/a.ts'))).toBe(false);
  });

  it('reads a single pattern as a list of one', () => {
    const dir = pack(join(root, 'single'), '*.polyfill.js');
    expect(skipper(root)(join(dir, 'src/fetch.polyfill.js'))).toBe(true);
  });

  it('leaves a source whose built output the list names', () => {
    const dir = pack(join(root, 'built'), ['./dist/register.js']);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } }));
    const skipped = skipper(root);
    expect(skipped(join(dir, 'src/register.ts'))).toBe(true);
    expect(skipped(join(dir, 'src/a.ts'))).toBe(false);
  });

  it('rewrites a package that declares none, or says it has none', () => {
    const skipped = skipper(root);
    expect(skipped(join(pack(join(root, 'pure'), false), 'src/a.ts'))).toBe(false);
    expect(skipped(join(pack(join(root, 'silent')), 'src/a.ts'))).toBe(false);
  });

  it('reads the nearest package.json', () => {
    const outer = pack(join(root, 'outer'), true);
    const inner = pack(join(outer, 'inner'), false);
    expect(skipper(root)(join(inner, 'src/a.ts'))).toBe(false);
  });

  it('leaves this package and ioc, which both declare theirs', () => {
    const skipped = skipper(root);
    expect(skipped(fileURLToPath(new URL('./runtime.ts', import.meta.url)))).toBe(true);
    expect(skipped(fileURLToPath(new URL('../../ioc/src/reset/state.ts', import.meta.url)))).toBe(true);
  });
});
