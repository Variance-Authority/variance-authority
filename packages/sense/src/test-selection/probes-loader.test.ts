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

  it('opens a module it probes with the collector, on the first line, and moves the map with it', async () => {
    const root = await checkout();
    const transformed = `${SOURCE}\n`;
    const { error, code, map } = load(resolve(root, 'cart.js'), transformed, IDENTITY, { root });

    expect(error).toBeNull();
    const opening = code!.slice(0, code!.indexOf(';') + 1);
    expect(opening).toMatch(/^import "!!.*probes-loader\.js\?collector=presence!.*probes-collector\.js";$/);
    expect(code!.split('\n')).toHaveLength(transformed.split('\n').length);
    // The file's first column is where the map says, past the opening and the probes.
    const mappings = (map as { mappings: string }).mappings;
    expect(decode(mappings)[0]![0]!.column).toBe(code!.indexOf('export function total'));
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

  it('refuses a key no rule in this process registered, as a loader in a worker would hold', () => {
    expect(() => includeOf('include-0')).toThrow(/worker/);
  });
});
