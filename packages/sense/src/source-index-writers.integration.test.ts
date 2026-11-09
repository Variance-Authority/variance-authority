import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import { native } from './addon.js';
import { readPublishedSources, updateSourceIndex } from './published.js';
import { scanRelations } from './scan.js';
import { openSourceIndex } from './source-index.js';
import { openSourceIndexFile } from './source-index-file.js';
import { encodeSourceIndex } from './source-index-format.js';

/**
 * Writers that share one index, rather than one each.
 *
 * Isolation is meant to come from the chain, not from the path it is kept at:
 * every segment is immutable, the manifest is the commit, and a writer whose
 * chain moved after it read it publishes nothing. If that holds, a cache can be
 * shared by every root that reads the same bytes; if it does not, the path key
 * is what keeps writers apart and a shared cache would corrupt.
 */

describe('writers saving one source index at once', () => {
  let base: string;
  const roots: string[] = [];

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'variance-writers-'));
    for (const name of ['one', 'two', 'three', 'four']) {
      const root = join(base, name);
      await write(root, 'package.json', `{ "name": "${name}" }`);
      await write(root, 'app/index.ts', "import { unit } from '../lib/unit.js';\nexport const app = unit;\n");
      await write(root, 'lib/unit.ts', `export const unit = '${name}';\n`);
      await write(root, `lib/${name}.ts`, `export const ${name} = 1;\n`);
      git(root, 'init', '--quiet');
      git(root, 'add', '.');
      git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
      roots.push(root);
    }
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('leaves a whole chain that answers for one of them, and each of them reads a valid cache after', async () => {
    const at = join(base, 'cache', 'source-index.bin');

    const updates = await Promise.allSettled(roots.map((root) => updateSourceIndex(root, { index: at })));
    expect(updates.map((update) => update.status)).toEqual(roots.map(() => 'fulfilled'));

    expect((await openSourceIndex(at)).state).toBe('published');
    const held = (await readPublishedSources(at)).records;
    const scans = await Promise.all(roots.map((root) => scanRelations({ root, dirs: ['.'] })));
    expect(scans).toContainEqual(held);

    for (const [at_, root] of roots.entries()) {
      await updateSourceIndex(root, { index: at });
      expect((await openSourceIndex(at)).state).toBe('published');
      expect((await readPublishedSources(at)).records).toEqual(scans[at_]);
    }
  });

  it('never shows a reader a damaged chain while processes publish to it', async () => {
    expect(native()).toBeDefined();
    const loaded = createRequire(import.meta.url).cache;
    const addon = Object.keys(loaded).find((key) => key.endsWith('.node') && loaded[key]?.exports === native());
    expect(addon).toBeDefined();
    const at = join(base, 'processes', 'source-index.bin');
    await mkdir(dirname(at), { recursive: true });
    const payloads = await Promise.all(['a', 'b', 'c', 'd'].map(async (writer) => {
      const digest = `git:${writer.repeat(40).replace(/[^0-9a-f]/g, 'e')}` as Digest;
      const bytes = encodeSourceIndex({
        parses: new Map([[digest, { requests: [], exports: [], symbols: [], declares: [] }]]),
        directories: new Map(),
        records: new Map(),
      });
      const file = join(base, 'processes', `${writer}.segment`);
      await writeFile(file, bytes);
      return { digest, file };
    }));

    const script = [
      "const { readFileSync } = require('node:fs');",
      'const [addon, path, segment] = process.argv.slice(1);',
      'const scanner = require(addon);',
      'const bytes = readFileSync(segment);',
      'for (let round = 0; round < 60; round += 1) {',
      '  const refused = scanner.appendSourceIndex(path, [], false, [bytes]);',
      "  if (refused && !refused.includes('moved after it was read')) { console.error(refused); process.exit(1); }",
      '}',
    ].join('\n');
    const writers = payloads.map(({ file }) => new Promise<number | null>((done) => {
      const child = spawn(process.execPath, ['-e', script, addon!, at, file], { stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('exit', done);
    }));
    let running = true;
    const states = new Set<string>();
    const dropped = new Set<number>();
    const reading = (async () => {
      while (running) {
        states.add((await openSourceIndexFile(at)).state);
        const oriented = native()!.orientPackages!(roots[0]!, at, [], 1, 1);
        if (oriented) dropped.add(oriented.dropped);
        await new Promise((tick) => setImmediate(tick));
      }
    })();
    const exits = await Promise.all(writers);
    running = false;
    await reading;

    expect(exits).toEqual(payloads.map(() => 0));
    expect([...states].filter((state) => state !== 'published' && state !== 'missing')).toEqual([]);
    expect([...dropped].filter((count) => count > 0)).toEqual([]);
    const stored = (await openSourceIndexFile(at)).stored;
    expect(payloads.map(({ digest }) => stored.parses.has(digest))).toContain(true);
  });
});

async function write(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root });
}
