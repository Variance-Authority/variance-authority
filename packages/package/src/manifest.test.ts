import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { OFFERED, readOfferings } from './manifest.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

const temporary: string[] = [];

/** A workspace written from a map of relative path to contents. */
function workspace(files: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'variance-manifest-'));
  temporary.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return root;
}

afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true });
});

describe('what a manifest offers', () => {
  it('names where the code is and what lands in the tarball', () => {
    expect(OFFERED).toContain('exports');
    expect(OFFERED).toContain('files');
    expect(OFFERED).toContain('bin');
  });

  it('names no kind of dependency', () => {
    // A dependency graph is a different subject with different questions —
    // which range, which duplicate, which transitive licence — and tools built
    // for it answer them. This records what a package offers, not what it needs.
    expect(OFFERED.filter((key) => key.toLowerCase().includes('dependencies'))).toEqual([]);
    expect(OFFERED).not.toContain('version');
  });
});

describe('reading a workspace', () => {
  const offerings = readOfferings(WORKSPACE);
  const names = offerings.map((offering) => offering.name);

  it('finds every member of a `dir/*` glob and of a literal path', () => {
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('solo');
  });

  it('leaves out what a manifest says not to publish', () => {
    expect(names).not.toContain('hidden');
  });

  it('records the offered keys verbatim and nothing else', () => {
    const beta = offerings.find((offering) => offering.name === 'beta');
    expect(Object.keys(beta!.declared).sort()).toEqual(['bin', 'exports', 'files', 'main', 'type', 'types']);
    expect(beta!.declared['bin']).toEqual({ beta: './dist/bin.js' });
  });

  it('records only the keys an option asks for', () => {
    const [first] = readOfferings(WORKSPACE, { offered: ['files'] });
    expect(Object.keys(first!.declared)).toEqual(['files']);
  });

  it('maps a published declaration back to the source it was compiled from', () => {
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    const at = (subpath: string) =>
      alpha!.entrypoints.find((entry) => entry.subpath === subpath)?.source.slice(WORKSPACE.length);

    expect(at('.')).toBe('/packages/alpha/src/index.ts');
    // A component entrypoint is a normal thing to publish, and `.d.ts` says
    // nothing about which of the two extensions produced it.
    expect(at('./widget')).toBe('/packages/alpha/src/widget.tsx');
    // Already source. Nothing to undo.
    expect(at('./direct')).toBe('/packages/alpha/src/direct.ts');
  });

  it('opens a subpath written as a bare path to source', () => {
    // The shape a repository publishing its own TypeScript writes, and the one
    // most manifests outside this workspace use. Read as `no types condition`,
    // it left a package that had said exactly where its code was opening
    // nothing at all.
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    const plain = alpha!.entrypoints.find((entry) => entry.subpath === './plain');
    expect(plain?.source.slice(WORKSPACE.length)).toBe('/packages/alpha/src/plain.ts');
  });

  it('opens a subpath whose types sit one level down, under `import`', () => {
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    const nested = alpha!.entrypoints.find((entry) => entry.subpath === './nested');
    expect(nested?.source.slice(WORKSPACE.length)).toBe('/packages/alpha/src/nested.ts');
  });

  it('keeps a subpath that declares no types, and opens nothing for it', () => {
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    expect(Object.keys(alpha!.declared['exports'] as object)).toContain('./raw');
    expect(alpha!.entrypoints.map((entry) => entry.subpath)).not.toContain('./raw');
  });
});

describe('what it refuses rather than guesses', () => {
  const manifest = { name: 'one', exports: { '.': { types: './dist/index.d.ts' } } };

  it('a workspace glob it does not understand', () => {
    const root = workspace({ 'package.json': { workspaces: ['packages/**/deep'] } });
    expect(() => readOfferings(root)).toThrow(/neither a path nor/);
  });

  it('a published declaration with no tsconfig to say what produced it', () => {
    const root = workspace({ 'package.json': manifest });
    expect(() => readOfferings(root)).toThrow(/not there to say what produced it/);
  });

  it('a tsconfig that declares no rootDir/outDir pair', () => {
    const root = workspace({ 'package.json': manifest, 'tsconfig.json': { compilerOptions: {} } });
    expect(() => readOfferings(root)).toThrow(/declares no `rootDir`\/`outDir` pair/);
  });

  it('a declaration that is not under the outDir it claims', () => {
    const root = workspace({
      'package.json': manifest,
      'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './build' } },
    });
    expect(() => readOfferings(root)).toThrow(/is not under this package's outDir/);
  });

  it('a declaration whose source is not on disk', () => {
    const root = workspace({
      'package.json': manifest,
      'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './dist' } },
    });
    expect(() => readOfferings(root)).toThrow(/maps to `.*src\/index.ts`, which is not there/);
  });
});

describe('a repository that is not a monorepo', () => {
  it('is one package, read from the manifest at its root', () => {
    const root = workspace({
      'package.json': { name: 'only', exports: { '.': { types: './src/index.ts' } } },
      'src/index.ts': 'export const one = 1;\n',
    });
    expect(readOfferings(root).map((offering) => offering.name)).toEqual(['only']);
  });
});
