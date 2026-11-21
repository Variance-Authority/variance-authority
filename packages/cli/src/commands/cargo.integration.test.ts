import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { run } from './ask-packages.fixture.js';
import { committedCheckout, repository } from './committed-checkout.fixture.js';

// #1625: a Cargo suite recorded by `variance cargo` is the record `covering` reads.
const crate = join(repository, 'packages/sense/test/fixtures/cargo-crate');

/** The fixture crate's files, by their path inside it. */
async function crateFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const path of await readdir(crate, { recursive: true, withFileTypes: true })) {
    if (!path.isFile()) continue;
    const at = join(path.parentPath, path.name);
    files[relative(crate, at)] = await readFile(at, 'utf8');
  }
  return files;
}

describe('`variance cargo` on a crate that declares one suite', () => {
  const cwd = process.cwd();
  const previous = { cache: process.env['VARIANCE_AUTHORITY_CACHE'], target: process.env['CARGO_TARGET_DIR'] };
  let root: string;
  let cache: string;
  let recorded: number;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-cargo-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    process.env['CARGO_TARGET_DIR'] = join(cache, 'target');
    root = await committedCheckout('variance-cargo-', {
      ...(await crateFiles()),
      'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit' } } }),
    });
    process.chdir(root);
    recorded = (await run(['cargo'])).code;
  }, 240_000);

  afterAll(async () => {
    process.chdir(cwd);
    for (const [name, value] of [['VARIANCE_AUTHORITY_CACHE', previous.cache], ['CARGO_TARGET_DIR', previous.target]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await Promise.all([cache, root].map((path) => rm(path, { recursive: true, force: true })));
  });

  it('passes when every test does', () => {
    expect(recorded).toBe(EXIT_CLEAN);
  });

  it('names for `add` exactly the tests that ran it', async () => {
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out } = await run(['covering', '--file', 'src/lib.rs', '--function', 'add']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('tests::adds');
    expect(out).toContain('tests::muls');
    expect(out).not.toContain('tests::negs');
    expect(out).not.toContain('negates');
  }, 120_000);
});
