import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureModule } from './captured-modules.js';
import { landRun } from './commit-runs.js';
import { coverageModule } from './coverage-rows.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { layCoverage } from './format-layer.js';
import { BLOB, FORMAT, NO_BLOB, PHASES, UNKEYED_FORMAT, sections, type Header, type Stored } from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import type { CoverageModule, TestCoverage } from './index.js';

const TEST = 'test/alpha.test.ts';

function module(file: string, sourceBlob?: string): CoverageModule {
  return {
    file,
    sourceDigest: `source:${file}`,
    ...(sourceBlob === undefined ? {} : { sourceBlob }),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module', digest: `block:${file}`, name: '', path: 'module',
      startLine: 1, endLine: 3, source: true, testFiles: [TEST],
    }],
  };
}

function coverage(modules: readonly CoverageModule[]): TestCoverage {
  return { version: 3, instrumentation: 'fixture', tests: [{ file: TEST, complete: true, preconditions: [] }], modules };
}

function relaid(bytes: Buffer, version: number, without: readonly string[]): Buffer {
  const length = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.toString('utf8', 4, 4 + length).replace(/\0+$/, '')) as Header;
  const kept: Record<string, Stored> = {};
  for (const section of header.sections) {
    if (without.includes(section.name)) continue;
    const plain = bytes.subarray(4 + length + section.offset, 4 + length + section.offset + section.length);
    kept[section.name] = { plain, rows: section.length / section.width, width: section.width };
  }
  return sections(kept, version);
}

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CART = 'export function total(items) {\n  return items.length;\n}\n';

/** A checkout at its first commit holding `src/cart.js` as `text` on disk, with `config` set before it was added, hashing its objects with `hash`. */
async function checkout(text: string, config: readonly [string, string][] = [], hash: 'sha1' | 'sha256' = 'sha1') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-format-blob-')));
  made.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch', 'main', `--object-format=${hash}`);
  for (const [key, value] of config) git('config', key, value);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/cart.js'), text);
  git('add', '.');
  git('commit', '--quiet', '-m', 'cart');
  return { root, git, file: join(root, 'src/cart.js'), record: join(root, 'coverage.bin') };
}

/** Record `text` as the recorder cuts the module it was handed, and land the run at `root`'s commit. */
async function landed(root: string, file: string, record: string, text: string, commit: string): Promise<string | undefined> {
  const captured = captureModule(root, file, text, () => true, undefined)!;
  await landRun(record, {
    version: 3, instrumentation: 'fixture', commit,
    tests: [{ file: TEST, complete: true, preconditions: [] }],
    modules: [coverageModule(captured.module, () => [TEST])],
  }, root);
  return decodeTestCoverage(await readFile(record)).modules.find((each) => each.file === 'src/cart.js')?.sourceBlob;
}

describe('the git name a landing gives the text a module row was cut from', () => {
  it('is the name the commit gives a clean file, where git cleans the file on the way in', async () => {
    // `core.autocrlf` stores the text with LF and leaves CRLF on disk: the bytes the run read are not the blob's.
    const crlf = CART.replaceAll('\n', '\r\n');
    const { root, git, file, record } = await checkout(crlf, [['core.autocrlf', 'true']]);

    expect(await landed(root, file, record, crlf, git('rev-parse', 'HEAD'))).toBe(`git:${git('rev-parse', 'HEAD:src/cart.js')}`);
  });

  it('is the name git hashes a dirty file to', async () => {
    const { root, git, file, record } = await checkout(CART);
    const edited = CART.replace('items.length;', 'items.length + 1;');
    await writeFile(file, edited);

    expect(await landed(root, file, record, edited, git('rev-parse', 'HEAD'))).toBe(`git:${git('hash-object', 'src/cart.js')}`);
  });

  it('is the repository\'s own SHA-256 name, for a clean file and a dirty one, where the repository hashes its objects with SHA-256', async () => {
    const { root, git, file, record } = await checkout(CART, [], 'sha256');
    const commit = git('rev-parse', 'HEAD');
    const clean = await landed(root, file, record, CART, commit);
    const edited = CART.replace('items.length;', 'items.length + 1;');
    await writeFile(file, edited);
    const dirty = await landed(root, file, record, edited, commit);

    expect([clean, dirty]).toEqual([`git:${git('rev-parse', 'HEAD:src/cart.js')}`, `git:${git('hash-object', 'src/cart.js')}`]);
    expect(clean).toMatch(/^git:[0-9a-f]{64}$/u);
  });

  it('is none for a dirty file edited again after the run read it', async () => {
    const { root, git, file, record } = await checkout(CART);
    const edited = CART.replace('items.length;', 'items.length + 1;');
    await writeFile(file, edited);
    const captured = captureModule(root, file, edited, () => true, undefined)!;
    await writeFile(file, CART.replace('items.length;', 'items.length + 2;'));
    await landRun(record, {
      version: 3, instrumentation: 'fixture', commit: git('rev-parse', 'HEAD'),
      tests: [{ file: TEST, complete: true, preconditions: [] }],
      modules: [coverageModule(captured.module, () => [TEST])],
    }, root);

    expect(decodeTestCoverage(await readFile(record)).modules[0]!.sourceBlob).toBeUndefined();
  });

  it('is none outside a checkout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'variance-format-blob-')));
    made.push(root);
    await writeFile(join(root, 'cart.js'), CART);

    const captured = captureModule(root, join(root, 'cart.js'), CART, () => true, undefined)!;
    await landRun(join(root, 'coverage.bin'), {
      version: 3, instrumentation: 'fixture', commit: 'C',
      tests: [{ file: TEST, complete: true, preconditions: [] }],
      modules: [coverageModule(captured.module, () => [TEST])],
    }, root);

    expect(decodeTestCoverage(await readFile(join(root, 'coverage.bin'))).modules[0]!.sourceBlob).toBeUndefined();
  });
});

describe('the git name of the text a module row was cut from', () => {
  it('is stored a module, and a module recorded without one reads back without one', () => {
    const written = encodeTestCoverage(coverage([module('src/a.ts', 'git:aa'), module('src/b.ts')]));

    expect(decodeTestCoverage(written).modules.map((each) => each.sourceBlob)).toEqual(['git:aa', undefined]);
    const view = openTestCoverage(written);
    expect(view.moduleBlob?.at(1)).toBe(NO_BLOB);
    expect(view.string(view.moduleBlob!.at(0))).toBe('git:aa');
  });

  it('opens a snapshot written before the key was recorded, as one with no key anywhere', () => {
    const unkeyed = relaid(encodeTestCoverage(coverage([module('src/a.ts', 'git:aa')])), UNKEYED_FORMAT, [BLOB]);

    expect(openTestCoverage(unkeyed).moduleBlob).toBeUndefined();
    expect(decodeTestCoverage(unkeyed).modules.map((each) => each.sourceBlob)).toEqual([undefined]);
  });

  it('refuses a current-layout snapshot that lacks the key section', () => {
    const lacking = relaid(encodeTestCoverage(coverage([module('src/a.ts')])), FORMAT, [BLOB]);

    expect(() => openTestCoverage(lacking)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('is carried by a layer over a module the run did not reach, and taken from the run where it did', () => {
    const held = encodeTestCoverage(coverage([module('src/a.ts', 'git:aa'), module('src/b.ts', 'git:bb')]));

    const layered = layCoverage(held, coverage([module('src/b.ts', 'git:b2')]));

    expect(decodeTestCoverage(layered).modules.map((each) => [each.file, each.sourceBlob])).toEqual([
      ['src/a.ts', 'git:aa'],
      ['src/b.ts', 'git:b2'],
    ]);
  });

  it('layers a run over an unkeyed snapshot into the current layout, keyed only where the run keyed it', () => {
    const unkeyed = relaid(encodeTestCoverage(coverage([module('src/a.ts'), module('src/b.ts')])), UNKEYED_FORMAT, [BLOB]);

    const layered = layCoverage(unkeyed, coverage([module('src/b.ts', 'git:b2')]));

    expect(decodeTestCoverage(layered).modules.map((each) => [each.file, each.sourceBlob])).toEqual([
      ['src/a.ts', undefined],
      ['src/b.ts', 'git:b2'],
    ]);
  });

  it('lets the unphased layout keep lacking both', () => {
    expect(UNKEYED_FORMAT).toBe(FORMAT - 1);
    expect(PHASES).not.toBe(BLOB);
  });
});
