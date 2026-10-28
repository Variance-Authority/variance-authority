import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { refreshDependencyLexicon } from '../dependency-lexicon.js';
import { symbol } from './symbol.js';

/**
 * `symbol --from` answers as the workspace that owns the path resolves the name.
 * `alpha` and `beta` install different versions of one package, so each gets its
 * own signature; `gamma` declares neither, so it is told where the name is.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

/** The three workspaces, indexed and with their dependency lexicon published, with `extra` files beside them. */
async function fixture(extra: Record<string, string> = {}): Promise<string> {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-symbol-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const kit = (version: string, signature: string): Record<string, string> => ({
    'package.json': JSON.stringify({ name: 'shared-kit', version, types: 'index.d.ts' }),
    'index.d.ts': `export declare function sharedName(${signature}): void;\n`,
  });
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/alpha/package.json': JSON.stringify({ name: 'alpha', dependencies: { 'shared-kit': '1.0.0' } }),
    'packages/alpha/src/x.ts': 'export const alpha = 1;\n',
    'packages/beta/package.json': JSON.stringify({ name: 'beta', dependencies: { 'shared-kit': '2.0.0' } }),
    'packages/beta/src/x.ts': "import { sharedName } from 'shared-kit';\nsharedName('a', 1);\n",
    'packages/gamma/package.json': JSON.stringify({ name: 'gamma' }),
    'packages/gamma/src/x.ts': 'export const gamma = 1;\n',
    ...extra,
  };
  for (const [owner, [version, signature]] of Object.entries({ alpha: ['1.0.0', 'a: string'], beta: ['2.0.0', 'a: string, b: number'] } as const)) {
    for (const [file, value] of Object.entries(kit(version, signature))) files[`packages/${owner}/node_modules/shared-kit/${file}`] = value;
  }
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  await refreshDependencyLexicon(root);
  return root;
}

it('resolves the version and signature from the owning workspace, and says where a name is when it is not usable', async () => {
  const root = await fixture();
  const help = readHelp(root);
  const ask = (from?: string): string => symbol.run(help, from === undefined ? { name: 'sharedName' } : { name: 'sharedName', from }, { root });
  const alpha = ask('packages/alpha/src/x.ts');
  expect(alpha).toContain('shared-kit@1.0.0');
  expect(alpha).toContain('a: string');
  expect(alpha).not.toContain('b: number');
  expect(alpha).toContain('dependency in packages/alpha/package.json · not imported');
  const beta = ask('packages/beta/src/x.ts');
  expect(beta).toContain('shared-kit@2.0.0');
  expect(beta).toContain('b: number');
  expect(beta).toContain('imported 1× (first packages/beta/src/x.ts:1)');
  for (const from of ['packages/gamma/src/x.ts', 'packages/gamma']) {
    const gamma = ask(from);
    expect(gamma).toContain(`is not usable from ${from}: packages/gamma/package.json does not declare or import it. It is offered under:`);
    expect(gamma).toContain('shared-kit@1.0.0');
    expect(gamma).toContain('shared-kit@2.0.0');
  }
  expect(ask()).toContain('shared-kit@2.0.0');
});

// The workspace answers nothing for the name, so it may be declared in a file
// whose declarations were not read, and the installed answer says which.
it('names the files whose declarations were not read beside an installed answer', async () => {
  const root = await fixture({ 'packages/gamma/src/huge.ts': `export const huge = 1;\n${'// filler line\n'.repeat(80_000)}` });
  const help = readHelp(root);
  const note = 'The declarations of 1 file were not read into the source index, so a name declared there is not known: packages/gamma/src/huge.ts.';
  const listed = symbol.run(help, { name: 'sharedName' }, { root });
  expect(listed).toContain('shared-kit@2.0.0');
  expect(listed).toContain(note);
  const elsewhere = symbol.run(help, { name: 'sharedName', from: 'packages/gamma/src/x.ts' }, { root });
  expect(elsewhere).toContain('is not usable from packages/gamma/src/x.ts');
  expect(elsewhere).toContain(note);
});
