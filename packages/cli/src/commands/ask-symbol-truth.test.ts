import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` says one of three facts about a name: where the
 * workspace declares it, the container it is a member of, or that nothing
 * declares it. The dependency lexicon is named only where it could change
 * that answer — a name the workspace does not declare — and then as what was
 * not checked, never as the whole answer.
 */

const cwd = process.cwd();
const cache = process.env['VARIANCE_AUTHORITY_CACHE'];

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-truth-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
});

const NATIVE = {
  'packages/lib/src/native.ts':
    'export interface Scanner {\n  resolveThings?(root: string): string[];\n}\n\nfunction edgeKindBetween(left: string, right: string): string {\n  return left + right;\n}\n\nexport const scanner = (): Scanner => ({ edge: edgeKindBetween });\n',
};

/** The two files of the checkout's dependency lexicon, beside its source index. */
function lexiconFiles(root: string): readonly string[] {
  const directory = dirname(sourceIndexPath(root));
  return [join(directory, 'dependency-lexicon.bin'), join(directory, 'dependency-lexicon.sites.bin')];
}

/** The checkout, indexed, with its dependency lexicon removed when `lexicon` is false. */
async function indexed(lexicon: boolean): Promise<string> {
  const root = checkout(NATIVE);
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  expect(lexiconFiles(root).map(existsSync)).toEqual([true, true]);
  if (!lexicon) for (const file of lexiconFiles(root)) rmSync(file);
  return root;
}

describe('variance ask symbol says what is true of a name', () => {
  for (const lexicon of [true, false]) {
    const state = lexicon ? 'published' : 'not published';

    it(`answers a member with its container, the lexicon ${state}`, async () => {
      await indexed(lexicon);
      const { code, out } = await run(['ask', 'symbol', '--name', 'resolveThings']);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain('a member of `Scanner`, declared at packages/lib/src/native.ts:2');
      expect(out).not.toContain('lexicon');
    });

    it(`answers a function its file keeps with where it is written, the lexicon ${state}`, async () => {
      await indexed(lexicon);
      const { code, out } = await run(['ask', 'symbol', '--name', 'edgeKindBetween']);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toContain('declared, not exported, at packages/lib/src/native.ts:5');
      expect(out).not.toContain('lexicon');
    });
  }

  it('says nothing in the workspace declares an absent name, and that its dependencies were not checked', async () => {
    const root = await indexed(false);
    // An answer not compared with the checkout leaves the lexicon as it found it.
    const { code, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten', '--just-answer']);
    expect(lexiconFiles(root).map(existsSync)).toEqual([false, false]);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).not.toMatch(/^variance: the dependency lexicon is not published/m);
    expect(err).toContain('No file in this workspace declares `nowhereWritten`, at its top level or as a member.');
    expect(err).toContain(
      'Whether an installed dependency publishes it is not known: the dependency lexicon is not published, and `variance index` publishes it.',
    );
  });

  it('says nothing in the workspace or its installed dependencies declares an absent name', async () => {
    await indexed(true);
    const { code, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten']);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('No file in this workspace declares `nowhereWritten`, at its top level or as a member.');
    expect(err).toContain('No installed dependency publishes it either.');
    expect(err).not.toContain('not known');
  });

  it('publishes the lexicon a refusal of an absent name needs, and says no installed dependency publishes it', async () => {
    const root = await indexed(false);
    const { code, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten']);
    expect(lexiconFiles(root).map(existsSync)).toEqual([true, true]);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('No installed dependency publishes it either.');
    expect(err).not.toContain('not known');
  });

  it('names only the installed package it checked, when asked about one package', async () => {
    await indexed(true);
    const { code, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten', '--package', '@acme/lib']);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('No installed dependency named `@acme/lib` publishes it either.');
    expect(err).not.toContain('No installed dependency publishes it either.');
  });

  it('says only the files the source index read declare nothing, when it declined one', async () => {
    checkout({
      ...NATIVE,
      // Past the largest file a read opens, so the index holds no parse of it.
      'packages/lib/src/huge.ts': `export const huge = 1;\n${'// filler line\n'.repeat(80_000)}`,
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, err } = await run(['ask', 'symbol', '--name', 'nowhereWritten']);
    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('No file in this workspace that the source index read declares `nowhereWritten`, at its top level or as a member.');
    expect(err).toContain('The declarations of 1 file were not read into the source index, so a name declared there is not known: packages/lib/src/huge.ts.');
  });

  it('answers a name one file exports and another keeps with both, and gives `intersection` the one it keeps', async () => {
    // The export does not stand for the declaration, and neither is a member.
    checkout({ ...NATIVE, 'packages/lib/src/edges.ts': 'export const edgeKindBetween = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'edgeKindBetween']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('exported, without being published, at packages/lib/src/edges.ts:1');
    expect(out).toContain('declared, not exported, at packages/lib/src/native.ts:5');
    expect(out).not.toContain('a member of');

    const both = await run(['ask', 'intersection', 'symbol --name edgeKindBetween', 'discover --from packages/lib/src/native.ts']);
    expect(both.err).toBe('');
    expect(both.code).toBe(EXIT_CLEAN);
    expect(both.out).toContain('packages/lib/src/native.ts — 1: line 5');
  });

  it('gives a member\'s declaring file to `intersection` at the line that declares it', async () => {
    await indexed(true);
    const { code, out, err } = await run(['ask', 'intersection', 'symbol --name resolveThings', 'discover --from packages/lib/src/native.ts']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('packages/lib/src/native.ts — 1: line 2');
  });

  // FIXME: a file the chain holds no parse of — written after the source index — is not named among the unread.
  it.todo('names a file written after the source index as one whose declarations were not read — needs the unread list to compare the checkout against what the chain parsed');
  // FIXME: a Rust struct field is no member until the scan records Rust fields and variants as members.
  it.todo('answers a Rust struct field with the struct it is a member of — needs the scan to record Rust fields and variants as members (#424)');
  // FIXME: a method of a Rust `impl` or a trait is no member, so `ask symbol` says no file declares it.
  it.todo('answers a method of a Rust `impl` or trait with the type it is on — needs the Rust member reader (#424) to record `impl` and trait items');
  // FIXME: a Python attribute assigned on `self` in a method is a statement, not a declaration, so `ask symbol` says no file declares it.
  it.todo('answers a Python attribute assigned on `self` with the class it is on — needs the Python reader to record assignments to `self` in a method');
});
