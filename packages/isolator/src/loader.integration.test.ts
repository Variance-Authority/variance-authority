import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack, type Stats } from '@rspack/core';
import { afterEach, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, '../test/fixtures/loader');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const build = (entry: string, output: string): Promise<Stats> =>
  new Promise((done, fail) => {
    rspack({
      mode: 'none',
      target: 'node',
      context: fixture,
      entry: { [entry]: `./src/${entry}.ts` },
      output: { path: output, library: { type: 'commonjs2' } },
      resolve: { extensions: ['.ts', '.js'] },
      module: {
        rules: [
          { test: /\.ts$/, loader: 'builtin:swc-loader', options: { jsc: { parser: { syntax: 'typescript' } } } },
          { test: /\.ts$/, enforce: 'pre', loader: resolve(here, '../dist/loader.js') },
        ],
      },
    }).run((error, stats) => (error ? fail(error) : done(stats!)));
  });

it('builds a module whose state starts again in every session', async () => {
  const output = await mkdtemp(resolve(tmpdir(), 'variance-authority-isolator-'));
  temporary.push(output);
  const stats = await build('counter', output);
  expect(stats.hasErrors()).toBe(false);
  const { next, nextSession } = createRequire(import.meta.url)(resolve(output, 'counter.js')) as {
    next: () => number;
    nextSession: () => void;
  };
  nextSession();
  expect([next(), next()]).toEqual([1, 2]);
  nextSession();
  expect(next()).toBe(1);
});

it('warns of a declaration it leaves shared, with the file and the line', async () => {
  const output = await mkdtemp(resolve(tmpdir(), 'variance-authority-isolator-'));
  temporary.push(output);
  const stats = await build('shared', output);
  expect(stats.toJson({ warnings: true }).warnings?.map((warning) => warning.message).join('\n')).toContain(
    'isolator: src/shared.ts:1 `shared` stays shared',
  );
});
