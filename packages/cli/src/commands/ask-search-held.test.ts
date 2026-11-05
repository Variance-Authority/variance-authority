import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
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
  'packages/kit/src/slots.ts': 'export interface Slots {\n  default: string;\n}\n\nconst keptHere = 1;\nexport const slots = keptHere;\n',
  'packages/kit/src/greet.ts': 'export default function greet(): number {\n  return 1;\n}\n',
  'packages/kit/src/hello.ts': "import greet from './greet';\nexport const hello = greet;\n",
  'packages/kit/src/needles.ts': [
    ...Array.from({ length: 30 }, (_, at) => `export interface Quiet${at} {\n  /** A needle in the doc. */\n  noted: string;\n}`),
    'export interface Target {',
    '  needleField: string;',
    '}',
    '',
    'export function holder(): number {',
    '  /** Says frobnicate, and is its holder\'s to say. */',
    '  function kept(): number {',
    '    return 1;',
    '  }',
    '  return kept();',
    '}',
    '',
  ].join('\n'),
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
  it.each(['Parsed', 'main', 'Parsed.exitZeroOnChanges', 'exitZeroOnChanges', 'rewindAll', 'toAccept', 'rarityOf', 'keptHere', 'taxOf', 'Slots.default', 'default'])('never denies `%s`, which symbol answers', async (name) => {
    checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    expect((await run(['ask', 'symbol', '--name', name])).out).not.toContain('No file in this workspace declares');
    const text = await searched(name);
    expect(text).toContain(name.split('.').at(-1));
    expect(text).not.toContain('nor a function inside a function, writes');
  });
});

describe('a name that is a held row of its own kind', () => {
  beforeEach(async () => {
    checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('answers a member named as the default slot is, which is a name there', async () => {
    expect(await searched('Slots.default')).toContain('Slots.default [member]');
  });

  it('puts a row whose name holds the words before the rows whose doc alone does', async () => {
    const said = await searched('needle');
    expect(said).toContain('Target.needleField [member]');
  });

  it('does not answer a closure by its doc, which is its holder\'s to say', async () => {
    expect(await searched('frobnicate')).not.toContain('kept [function]');
  });

  it('lists no import that binds a declaration by its own name', async () => {
    expect(await searched('greet')).not.toContain('as a local name');
  });
});

describe('a row that only holds the words', () => {
  it('leaves the nearest names offered beside it', async () => {
    checkout({ ...HELD, 'packages/kit/src/near.ts': '/** Applies a budget. */\nexport function measure(): number {\n  return 1;\n}\n\nexport class Thing {\n  meesureSum = 1;\n}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const text = await searched('meesure');
    expect(text).toContain('Thing.meesureSum [member]');
    expect(text).toContain('measure — @acme/kit · packages/kit/src/near.ts:2');
  });
});

describe('the words of an empty answer', () => {
  it('names what was read, not every declaration', async () => {
    checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const text = await searched('qqzzq');
    expect(text).toContain('No export, top-level declaration or member of a class, an interface or a type in this repository, nor the doc of one, nor a function inside a function, writes `qqzzq`.');
  });

  it('names the language whose members were not read', async () => {
    checkout({ ...HELD, 'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n', 'packages/kit/src/lib.rs': 'pub fn restart() {}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    expect(await searched('qqzzq')).toContain("this workspace's Rust files were not read for them");
  });

  it('names that language for a phrase too, since a member\'s doc there was not read either', async () => {
    checkout({ ...HELD, 'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n', 'packages/kit/src/lib.rs': 'pub fn restart() {}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const text = await searched('qq-zzq');
    expect(text).toContain("this workspace's Rust files were not read for them");
    expect(text).not.toContain('if `qq-zzq` is a member');
  });

  it('leaves that language out of an answer a held row gave, in JSON as in text', async () => {
    checkout({ ...HELD, 'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n', 'packages/kit/src/lib.rs': 'pub fn restart() {}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { out } = await run(['ask', 'search', '--query', 'rewindAl', '--format', 'json']);
    expect(JSON.parse(out)).not.toHaveProperty('membersUnread');
  });

  it('still answers when the source index does not read, and says so', async () => {
    const root = checkout(HELD);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    writeFileSync(sourceIndexPath(root), 'not a source index');
    const { code, out } = await run(['ask', 'search', '--query', 'qqzzq']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('run `variance index`');
  });
});
