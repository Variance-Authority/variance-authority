import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decode } from './map-segments.js';
import probesLoader, { type ProbesLoaderContext } from './probes-loader.js';
import { executionCollectorSource } from './probes.js';
import { includeOf, testSelectionRule, type ProbesLoaderOptions } from './probes-rule.js';
import type { HandedMap } from './loader-probes.js';

const SOURCE = 'export function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\n';
// Every line to itself, from its first column.
const IDENTITY = { version: 3, sources: ['cart.js'], names: [], mappings: 'AAAA;AACA;AACA' };

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { force: true, recursive: true });
  root = undefined;
});

/** What the loader handed on for `file` under `options`: code, map, or the error. */
function load(file: string, code: string, map: HandedMap, options: ProbesLoaderOptions & { collector?: string }) {
  let handed: { error: Error | null; code?: string; map?: HandedMap } | undefined;
  const context: ProbesLoaderContext = {
    resourcePath: file,
    getOptions: () => options,
    callback: (error, text, given) => {
      handed = { error, code: text, map: given };
    },
  };
  probesLoader.call(context, code, map);
  return handed!;
}

async function checkout(): Promise<string> {
  root = await mkdtemp(resolve(tmpdir(), 'variance-probes-loader-'));
  await writeFile(resolve(root, 'cart.js'), SOURCE, 'utf8');
  return root;
}

describe('the probes loader', () => {
  it('serves the collector of the recipe it is asked for', () => {
    expect(load('/anywhere/probes-collector.js', 'export {};\n', undefined, { collector: 'entries' }).code).toBe(
      executionCollectorSource('entries'),
    );
  });

  it('refuses a collector of a recipe that is none', () => {
    expect(load('/anywhere/probes-collector.js', '', undefined, { collector: 'lines' }).error?.message).toMatch(/recipe "lines"/);
  });

  it('ends a module it probes with an import of the collector, so a directive prologue stays first and no column moves', async () => {
    const root = await checkout();
    const client = `"use client";\n${SOURCE}`;
    await writeFile(resolve(root, 'client.js'), client, 'utf8');
    const { error, code, map } = load(resolve(root, 'client.js'), client, { ...IDENTITY, mappings: 'AAAA;AACA;AACA;AACA' }, { root });

    expect(error).toBeNull();
    expect(code!.startsWith('"use client";')).toBe(true);
    expect(code!.slice(code!.lastIndexOf('\n'))).toMatch(/^\n;import "!!.*probes-loader\.js\?collector=presence!.*probes-collector\.js";$/);
    // The second line opens with the header, where the map says.
    const lines = code!.split('\n');
    const columns = decode((map as { mappings: string }).mappings)[1]!.map((segment) => segment.column);
    expect(lines[1]!.indexOf('var __vaK')).toBe(0);
    expect(columns).toEqual([0]);
  });

  it('opens a script with a require of the collector after its prologue, so it stays strict, and moves the map with it', async () => {
    const root = await checkout();
    const script = '"use strict"; function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\nmodule.exports = { total };\n';
    await writeFile(resolve(root, 'total.js'), script, 'utf8');
    // Line 1: the directive at 0, the function at 14.
    const { error, code, map } = load(resolve(root, 'total.js'), script, { ...IDENTITY, sources: ['total.js'], mappings: 'AAAA,cAAc;AACd;AACA;AACA' }, { root });

    expect(error).toBeNull();
    const first = code!.split('\n')[0]!;
    expect(first.startsWith('"use strict";')).toBe(true);
    expect(first.indexOf('require("!!')).toBeLessThan(first.indexOf('var __vaK'));
    expect(code).not.toMatch(/\bimport\b/);
    // The header, which the map maps to the function, is where the map says, past the require.
    const columns = decode((map as { mappings: string }).mappings)[0]!.map((segment) => segment.column);
    expect(columns).toEqual([0, first.indexOf('var __vaK')]);
  });

  it('refuses a module the loaders before it rewrote and handed on no map, naming `devtool`', async () => {
    const root = await checkout();
    const { error } = load(resolve(root, 'cart.js'), `// rewritten\n${SOURCE}`, undefined, { root });

    expect(error?.message).toMatch(/`cart\.js`.*devtool/s);
  });

  it('passes a module `include` refuses untouched', async () => {
    const root = await checkout();
    const rule = testSelectionRule({ root, include: () => false });
    const handed = load(resolve(root, 'cart.js'), SOURCE, IDENTITY, rule.use[0].options);

    expect(handed).toEqual({ error: null, code: SOURCE, map: IDENTITY });
  });
});

describe('the rule', () => {
  it('runs the loader after the project’s, carrying `include` as a key to the function', () => {
    const include = (file: string) => file.endsWith('.ts');
    const rule = testSelectionRule({ root: process.cwd(), include, mode: 'entries' });

    expect(rule).toMatchObject({ enforce: 'post', use: [{ loader: expect.stringMatching(/probes-loader\.js$/) }] });
    expect(JSON.parse(JSON.stringify(rule.use[0].options))).toEqual(rule.use[0].options);
    expect(includeOf(rule.use[0].options.include!)).toBe(include);
    expect(testSelectionRule({ include }).use[0].options.include).toBe(rule.use[0].options.include);
  });

  it('keys `include` by its source, so the key is the same whichever rule registered first', () => {
    const include = (file: string) => file.includes('/keyed-by-source/');
    const key = testSelectionRule({ include }).use[0].options.include!;
    // The same text, a different function: a rule built again in a second run, or in another order.
    const again = (file: string) => file.includes('/keyed-by-source/');

    expect(key).toMatch(/^include-v1:[0-9a-f]+$/);
    expect(testSelectionRule({ include: again }).use[0].options.include).toBe(`${key}-2`);
    expect(includeOf(key)).toBe(include);
    expect(includeOf(`${key}-2`)).toBe(again);
  });

  it('leaves `node_modules` to the loaders where `include` is the default, and to `include` where it is given', () => {
    expect(testSelectionRule().exclude).toEqual(/[\\/]node_modules[\\/]/);
    expect(testSelectionRule().exclude!.test('/repo/node_modules/react/index.js')).toBe(true);
    expect(testSelectionRule({ include: () => true }).exclude).toBeUndefined();
  });

  it('refuses a key no rule in this process registered, as a loader in a worker would hold', () => {
    expect(() => includeOf('include-0')).toThrow(/worker/);
  });
});
