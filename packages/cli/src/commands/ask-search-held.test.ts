import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask search` about a name no export list holds and no top level
 * declares: a member, a function another function's body declares, and the
 * local name of an import. `symbol` answers each, so `search` saying nothing
 * writes one was a false statement of absence. Each is answered under what
 * holds it, in a section of its own, and a row that only holds the words stays
 * out of a search something else answered.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-search-held-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const HELD = {
  'packages/kit/src/parsed.ts': [
    'export interface Parsed {',
    '  /** Exit zero on a change, as `--to-accept` asks. */',
    '  readonly exitZeroOnChanges: boolean;',
    '}',
    '',
    'export class Runner {',
    '  /** Start over from the first case. */',
    '  private rewindAll(): void {}',
    '}',
    '',
    'export function main(): number {',
    '  function toAccept(): number {',
    '    return 1;',
    '  }',
    '  return toAccept();',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/rarity.ts': "export const rarity = 1;\n",
  'packages/kit/src/uses.ts': "import { rarity as rarityOf } from './rarity';\nexport const shown = rarityOf;\n",
};

const searched = async (query: string): Promise<string> => {
  const { code, out, err } = await run(['ask', 'search', '--query', query]);
  expect(err).toBe('');
  expect(code).toBe(EXIT_CLEAN);
  return out;
};

describe('variance ask search about a name under something that holds it', () => {
  beforeEach(async () => {
    checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('lists a member with its container, file and line', async () => {
    expect(await searched('exitZeroOnChanges')).toContain('Parsed.exitZeroOnChanges [member] — @acme/kit · packages/kit/src/parsed.ts:3');
  });

  it('lists a member asked for on its container', async () => {
    expect(await searched('Parsed.exitZeroOnChanges')).toContain('Parsed.exitZeroOnChanges [member] — @acme/kit · packages/kit/src/parsed.ts:3');
  });

  it('lists a function with the function that holds it, file and line', async () => {
    expect(await searched('toAccept')).toContain('toAccept [function] inside `main` — @acme/kit · packages/kit/src/parsed.ts:12');
  });

  it('lists the member whose doc writes the words', async () => {
    expect(await searched('to-accept')).toContain('Parsed.exitZeroOnChanges [member] — @acme/kit · packages/kit/src/parsed.ts:3');
  });

  it('lists the import that binds a local name', async () => {
    expect(await searched('rarityOf')).toContain("packages/kit/src/uses.ts:1 imports `rarity` as `rarityOf` from './rarity'");
  });

  it('leaves out of an answered search a row that only holds the words', async () => {
    expect(await searched('rewind')).toContain('Runner.rewindAll [member]');
    expect(await searched('first case')).toContain('Runner.rewindAll [member]');
    const answered = await searched('zero on a change');
    expect(answered).toContain('Parsed.exitZeroOnChanges [member]');
    const exported = await searched('parse');
    expect(exported).toContain('Parsed');
    expect(exported).not.toContain('[member]');
  });

  it('shows a row that is the question beside what else answered it', async () => {
    const shared = { 'packages/kit/src/named.ts': 'export interface Named {\n  readonly rarity: number;\n}\n' };
    checkout({ ...HELD, ...shared });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    expect(await searched('rarity')).toContain('Named.rarity [member]');
  });

  it('answers in json what the text answers', async () => {
    const { out } = await run(['ask', 'search', '--query', 'toAccept', '--format', 'json']);
    expect(JSON.parse(out).held.shown).toEqual([expect.objectContaining({ name: 'toAccept', holder: 'main', at: 'packages/kit/src/parsed.ts', line: 12 })]);
  });
});

describe('what search and symbol say of one name', () => {
  it.each(['Parsed', 'main', 'Parsed.exitZeroOnChanges', 'exitZeroOnChanges', 'rewindAll', 'toAccept', 'rarityOf'])('never denies `%s`, which symbol answers', async (name) => {
    checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    expect((await run(['ask', 'symbol', '--name', name])).code).toBe(EXIT_CLEAN);
    const text = await searched(name);
    expect(text).not.toMatch(/^No .* writes/mu);
  });
});

describe('the words of an empty answer', () => {
  it('names what was read, not every declaration', async () => {
    checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const text = await searched('qqzzq');
    expect(text).toContain('No export, top-level declaration or member in this repository, nor the doc of one, nor a function inside a function, writes `qqzzq`.');
  });

  it('names the language whose members were not read', async () => {
    checkout({ ...HELD, 'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n', 'packages/kit/src/lib.rs': 'pub fn restart() {}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    expect(await searched('qqzzq')).toContain("this workspace's Rust files were not read for them");
  });
});
