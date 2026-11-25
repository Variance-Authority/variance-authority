/// <depends path="../bin.ts" />
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { sourceIndexPath } from '@variance-authority/sense';
import { encodeAsSetExecutionIndex, recordOfCases, testCoverageFile } from '@variance-authority/sense/test-selection';
import { checkout, run } from './ask-packages.fixture.js';

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));

/** More packages than an answer names on one line. */
const FLAG_KITS = Array.from({ length: 10 }, (_, at) => `flag-kit-${at}`);

it.each([
  { question: ['packages'], contains: 'packages that declare no entry are imported by path' },
  { question: ['entrypoint', '--package', '@acme/lib'], contains: '@acme/lib — 2 names' },
  { question: ['entrypoint', '--package', '@acme/lib/src/internal/math'], contains: 'By name, most imported first:' },
  { question: ['entrypoint', '--package', '@acme/tools-only'], contains: 'opens no main entry' },
  { question: ['entrypoint', '--package=@acme/tools-only', '--subpath=./tools'], contains: '@acme/tools-only/tools — 2 names' },
  { question: ['entrypoint', '--package', '@acme/kit'], contains: 'declares no entry' },
  { question: ['entrypoint', '--package', '@acme/kit/src/money/tax'], contains: 'from @acme/kit/src/money/tax by path' },
  { question: ['entrypoint', '--package', '@acme/unfollowed'], contains: 'declares an entry this reading could not follow' },
  { question: ['entrypoint', '--package', '@acme/lib/missing'], contains: 'does not open `./missing`' },
  { question: ['symbol', '--name', 'greet'], contains: 'greet' },
  { question: ['symbol', '--name', 'greet', '--package', '@acme/lib'], contains: "import { greet } from '@acme/lib';" },
  { question: ['symbol', '--name', 'shared', '--package', '@acme/lib-exports'], contains: "import { shared } from '@acme/lib-exports';" },
  { question: ['symbol', '--name', 'addTax', '--package', '@acme/lib/src/internal/math'], contains: "import { addTax } from '@acme/lib/src/internal/math';" },
  { question: ['symbol', '--name', 'dualExport', '--package', '@acme/dual/tools'], contains: "import { dualExport } from '@acme/dual/tools';" },
  { question: ['symbol', '--name', 'wholeExport', '--package', '@acme/whole'], contains: 'passing the module on whole' },
  { question: ['symbol', '--name', '値', '--package', '@acme/lib'], contains: 'declared, not exported' },
  { question: ['symbol', '--name', 'externalOnly', '--package', 'search-kit'], contains: 'search-kit · externalOnly' },
  { question: ['symbol', '--name', 'greet', '--package', '@acme/kit'], contains: 'No file in `@acme/kit` declares `greet`' },
  { question: ['symbol', '--name', 'taxOf'], contains: 'taxOf' },
  { question: ['symbol', '--name', 'shared'], contains: "import { shared } from '@acme/lib-exports';" },
  { question: ['symbol', '--name', '値'], contains: '値' },
  { question: ['symbol', '--name', '値', '--limit', '1'], contains: '1 more declaration of `値`' },
  { question: ['symbol', '--name', 'unknownExactName'], contains: 'unknownExactName' },
  { question: ['symbol', '--name', 'taxOf, unknownExactName, greet, taxOf'], contains: 'No file in this workspace declares `unknownExactName`' },
  { question: ['symbol', '--limit=1', '--name=unknownExactName,anotherMissingName'], contains: 'No file in this workspace declares `anotherMissingName`' },
  { question: ['symbol', '--name', 'sessionToken', '--limit', '1'], contains: '1 more member declaration of `sessionToken`' },
  { question: ['symbol', '--name', 'AgentSession.sessionToken'], contains: 'a member of `AgentSession`' },
  { question: ['symbol', '--name', 'externalOnly'], contains: 'search-kit · externalOnly' },
  { question: ['symbol', '--name', 'CabinetLedger'], contains: 'names `CabinetLedger`' },
  { question: ['uses', '--name', 'greet'], contains: 'apps/app/src/hello.ts:1' },
  { question: ['uses', '--name', 'greet', '--package', '@acme/lib'], contains: 'apps/app/src/hello.ts:1' },
  { question: ['uses', '--name', 'shared', '--package', '@acme/lib-exports'], contains: 'is published and nothing' },
  { question: ['uses', '--name', 'addTax', '--package', '@acme/lib/src/internal/math'], contains: 'apps/app/src/total.ts:1' },
  { question: ['uses', '--name', 'dualExport', '--package', '@acme/dual/tools'], contains: 'apps/app/src/dual-tools.ts:1' },
  { question: ['uses', '--name', 'greet', '--package', '@acme/kit'], contains: 'No file in `@acme/kit` declares `greet`' },
  { question: ['uses', '--name=greet', '--from=packages/lib/src', '--limit=1'], contains: 'Nearest to packages/lib/src first.' },
  { question: ['uses', '--name', 'shared'], contains: 'packages/lib-exports/src/index.ts:2' },
  { question: ['uses', '--name', 'shared', '--file', 'packages/lib-exports/src/index.ts'], contains: 'is published and nothing' },
  { question: ['uses', '--name', 'greet', '--file', 'packages/lib/src/index.ts'], contains: 'packages/lib/src/also.ts:1' },
  { question: ['uses', '--name', 'taxOf'], contains: 'by path from @acme/kit/src/money/tax' },
  { question: ['uses', '--name', 'orphan'], contains: 'exported, without being published' },
  { question: ['uses', '--name', '値'], contains: 'Used in packages/lib/src/private.ts' },
  { question: ['uses', '--name', '値', '--file', 'packages/lib/src/private.ts'], contains: 'so nothing outside that file can import it' },
  { question: ['uses', '--name', 'unknownExactName'], contains: 'No file in this workspace declares' },
  { question: ['uses', '--name', 'sessionToken'], contains: 'No line uses `sessionToken` through a value whose type is written as `SavedSession`' },
  { question: ['uses', '--name', 'AgentSession.sessionToken', '--from', 'packages/lib/src/session.ts'], contains: 'Nearest to packages/lib/src/session.ts first.' },
  { question: ['search', '--query', 'greet'], contains: 'greet' },
  { question: ['search', '--query', 'taxOf'], contains: 'taxOf' },
  { question: ['search', '--query', 'levy'], contains: 'The levy on an amount.' },
  { question: ['search', '--query', 'read checkout'], contains: '1 exported match for `read checkout`' },
  { question: ['search', '--query', 'levy on an amount'], contains: 'The levy on an amount.' },
  { question: ['search', '--query', 'greot'], contains: '1 more name matches loosely' },
  { question: ['search', '--query', 'unknownExactName'], contains: 'No export, top-level declaration' },
  { question: ['search', '--query', 'quartz attestation'], contains: '1 recorded test case holds every word' },
  { question: ['search', '--query', 'ledgerCode'], contains: '(+1 more file)' },
  { question: ['search', '--query', 'shared', '--limit', '1'], contains: '1 more not shown' },
  { question: ['search', '--query', 'externalOnly'], contains: 'offered by some manifest in this workspace' },
  { question: ['search', '--query', 'kitExternal'], contains: 'third-party name matches `kitexternal`: search-kit · kitExternal.' },
  { question: ['search', '--query', 'greet', '--from', 'apps/app/src/hello.ts'], contains: 'files by distance: 0: 1' },
  { question: ['search', '--query', 'taxOf', '--to', 'packages/kit/src/money/tax.ts'], contains: 'reaching `packages/kit/src/money/tax.ts`' },
  { question: ['search', '--query', 'greet', '--from', 'missing.ts'], contains: 'No search was run' },
  { question: ['search', '--query=-only'], contains: "`variance ask search --query=-only --limit 20` lists all matching names." },
  { question: ['grep', '--query', 'greet', '--from', 'apps/app/src/hello.ts'], contains: 'greet' },
  { question: ['grep', '--query', 'greet', '--to', 'packages/lib/src/greet.ts'], contains: 'greet' },
  { question: ['grep', '--query', 'greet', '--from', 'packages/lib/src/greet.ts', '--to', 'packages/lib/src/greet.ts', '--limit', '1', '--offset', '1'], contains: 'Rows 2' },
  { question: ['grep', '--query', 'crowdedLine', '--from', 'apps/app/src/crowded/'], contains: "`variance ask discover --from apps/app/src/crowded/ --path '^apps/app/src/crowded/one\\.ts$' --text crowdedLine`: the 1 matching file" },
  { question: ['grep', '--query', 'absentText', '--from', 'apps/app/src/hello.ts'], contains: 'Nothing in those files matches' },
  { question: ['grep', '--query', '[', '--from', 'apps/app/src/hello.ts'], contains: 'ripgrep refused the pattern' },
  { question: ['grep', '--query', 'greet', '--from', 'missing.ts'], contains: 'is not found' },
  { question: ['discover', '--from', 'apps/app/src/hello.ts', '--declares', '^greet$'], contains: 'declares greet' },
  { question: ['discover', '--to', 'packages/lib/src/greet.ts', '--limit', '1', '--offset', '1'], contains: 'Rows 2–2' },
  { question: ['discover', '--to', 'packages/lib/src/greet.ts#greet'], contains: 'imports greet from @acme/lib' },
  { question: ['discover', '--to', 'packages/lib/src/greet.ts,packages/lib/src/index.ts'], contains: 'chains reaching `packages/lib/src/greet.ts` end:' },
  { question: ['discover', '--imports', 'packages/lib/src/greet.ts#greet'], contains: 'imports greet from @acme/lib' },
  { question: ['discover', '--imports', '@acme/lib#greet', '--except-path', '^packages/'], contains: 'importing `greet` from `@acme/lib`' },
  { question: ['discover', '--path', '^packages/lib/src/', '--text', 'export function greet'], contains: 'matches a line in 1 of the' },
  { question: ['discover', '--path', '^packages/lib/src/(?!greet\\.ts$).*'], contains: 'also.ts' },
  { question: ['discover', '--from', 'apps/app/src/hello.ts,packages/lib/src/also.ts', '--except-declares', '^greet$'], contains: 'taken out' },
  { question: ['discover', '--from', 'missing.ts'], contains: 'ran nothing' },
])('answers $question through the package bin with Node absent from PATH', async ({ question, contains }) => {
  const previous = process.cwd();
  const root = checkout({
    'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport const shared = 'lib';\n",
    'packages/lib-exports/src/index.ts': "export const slug = (title: string): string => title;\nexport const shared = 'lib-exports';\n",
    ...(question[1] === '--package=@acme/tools-only' || question[2] === '@acme/tools-only' ? {
      'packages/tools-only/package.json': JSON.stringify({ name: '@acme/tools-only', exports: { './tools': './src/index.ts' } }),
      'packages/tools-only/src/index.ts': '/** A receipt.\n * Shown in the task.\n *\n * Extra details.\n */\nexport const receipt = 1;\nexport const status = 2;\n',
    } : {}),
    ...(question[0] === 'packages' || question[2] === '@acme/unfollowed' ? {
      'packages/unfollowed/package.json': JSON.stringify({ name: '@acme/unfollowed', main: 'absent.js' }),
      'packages/unfollowed/src/file.ts': "export const held = 'exists';\n",
      'apps/app/src/unfollowed.ts': "import { held } from '@acme/unfollowed';\nexport const value = held;\n",
    } : {}),
    ...(question[2] === 'crowdedLine' ? {
      'apps/app/src/crowded/one.ts': '// crowdedLine\n'.repeat(150),
      'apps/app/src/crowded/two.ts': '// crowdedLine\n'.repeat(60),
    } : {}),
    ...(question[2] === 'dualExport' ? {
      'packages/dual/package.json': JSON.stringify({ name: '@acme/dual', exports: { '.': './src/index.ts', './tools': './src/index.ts' } }),
      'packages/dual/src/index.ts': "export const dualExport = 'dual';\n",
      'apps/app/src/dual-tools.ts': "import { dualExport } from '@acme/dual/tools';\nexport const fromTools = dualExport;\n",
      'apps/app/src/dual-root.ts': "import { dualExport } from '@acme/dual';\nexport const fromRoot = dualExport;\n",
    } : {}),
    ...(question[2] === 'wholeExport' ? {
      'packages/whole/package.json': JSON.stringify({ name: '@acme/whole', main: './src/index.ts' }),
      'packages/whole/src/index.ts': "export const wholeExport = 'held';\n",
      'apps/app/src/whole.ts': "import * as held from '@acme/whole';\nconsole.log(held);\n",
    } : {}),
    'packages/lib/src/also.ts': "import { greet as hello } from './greet.js';\nexport const also = hello('lib');\n",
    'packages/kit/src/money/tax.ts': '/** The levy on an amount. */\nexport function taxOf(amount: number) { return amount / 5; }\nexport const unusedRate = 0.2;\n',
    'packages/kit/src/ledger.ts': "export const ledgerCode = 'kit';\n",
    'packages/lib/src/ledger.ts': "export const ledgerCode = 'lib';\n",
    'packages/kit/src/reader.ts': 'export function readCheckout() { return 3; }\n',
    ...(['externalOnly', 'kitExternal'].includes(question[2] ?? '') ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: { 'search-kit': '1.0.0' } }),
      'node_modules/search-kit/package.json': JSON.stringify({ name: 'search-kit', version: '1.0.0', types: 'index.d.ts' }),
      'node_modules/search-kit/index.d.ts': 'export declare const externalOnly: true;\nexport declare const kitExternal: true;\n',
      'packages/kit/src/external.ts': 'export const kitExternal = true;\n',
    } : {}),
    ...(question[1] === '--query=-only' ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: Object.fromEntries(FLAG_KITS.map((name) => [name, '1.0.0'])) }),
      ...Object.fromEntries(FLAG_KITS.flatMap((name) => [
        [`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', types: 'index.d.ts', description: 'handles only flags.' })],
        [`node_modules/${name}/index.d.ts`, 'export declare const onlyFlags: true;\n'],
      ])),
      'packages/kit/src/flags.ts': 'export const onlyFlags = true;\n',
    } : {}),
    ...(question[2] === 'CabinetLedger' ? {
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*', 'apps/*'], dependencies: { 'readme-kit': '1.0.0' } }),
      'node_modules/readme-kit/package.json': JSON.stringify({ name: 'readme-kit', version: '1.0.0', main: 'index.js' }),
      'node_modules/readme-kit/index.js': 'module.exports = { CabinetLedger() {} };\n',
      'node_modules/readme-kit/README.md': '## CabinetLedger\n\nKeeps a list of cabinet entries.\n',
    } : {}),
    'packages/lib/src/private.ts': 'export const shown = 3;\nfunction 値() { return shown; }\nexport const used = 値();\n',
    'packages/lib/src/private.test.ts': 'export const other = 4;\nfunction 値() { return other; }\nexport const tested = 値();\n',
    'packages/lib/src/session.ts': 'interface AgentSession { sessionToken: string }\ninterface SavedSession { sessionToken: number }\nexport function tokenOf(session: AgentSession) { return session.sessionToken; }\n',
    ...(question[2] === 'packages/lib/src/greet.ts,packages/lib/src/index.ts' ? {
      'apps/app/src/bridge.ts': "export { hello } from './hello.js';\n",
      'apps/app/src/outer-a.ts': "import { hello } from './bridge.js';\nexport const a = hello;\n",
      'apps/app/src/outer-b.ts': "import { hello } from './bridge.js';\nexport const b = hello;\n",
    } : {}),
  });
  try {
    expect((await run(['index', '--wait'])).code).toBe(0);
    if (question[2] === 'quartz attestation') {
      const recording = testCoverageFile(root);
      const file = 'packages/lib/src/private.test.ts';
      const name = 'records a quartz attestation';
      mkdirSync(dirname(recording), { recursive: true });
      writeFileSync(recording, recordOfCases({ index: encodeAsSetExecutionIndex({ tests: [{ id: name, file, name }], modules: [] }) }));
    }
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const env = { ...process.env, npm_config_user_agent: '' };
    const args = ['ask', ...question];
    const expected = spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' });
    expect(expected.error).toBeUndefined();
    expect(expected.stdout + expected.stderr).toContain(contains);
    const actual = spawnSync(executable, args, { cwd: root, env: { ...env, PATH: empty }, encoding: 'utf8' });
    expect(actual.error).toBeUndefined();
    expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it('waits for a live index publisher with Node absent from PATH', async () => {
  const previous = process.cwd();
  const root = checkout();
  try {
    expect((await run(['index', '--wait'])).code).toBe(0);
    const index = sourceIndexPath(root);
    const lock = `${index}.follow-ups`;
    const log = `${index}.follow-ups.log`;
    writeFileSync(lock, JSON.stringify({ pid: process.pid, log }));
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const child = spawn(executable, ['ask', 'symbol', '--name', 'greet'], {
      cwd: root, env: { ...process.env, PATH: empty, npm_config_user_agent: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const waiting = `waiting for process ${process.pid} to finish the code map`;
    child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part; });
    child.stderr.setEncoding('utf8').on('data', (part: string) => {
      stderr += part;
      if (stderr.includes(waiting)) rmSync(lock, { force: true });
    });
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(status, stderr).toBe(0);
    expect(stderr).toContain(waiting);
    expect(stdout).toContain('greet [function]');
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === 'win32')('forwards a Node command when started through a package bin link', () => {
  const root = mkdtempSync(join(tmpdir(), 'variance-cli-bin-'));
  try {
    const linked = join(root, 'variance');
    symlinkSync(executable, linked);
    const env = { ...process.env, npm_config_user_agent: '' };
    const args = ['--version'];
    const expected = spawnSync(process.execPath, [nodeEntry, ...args], { env, encoding: 'utf8' });
    const actual = spawnSync(linked, args, { env, encoding: 'utf8' });
    expect(expected.status).toBe(0);
    expect(actual.error).toBeUndefined();
    expect([actual.status, actual.stdout, actual.stderr]).toEqual([expected.status, expected.stdout, expected.stderr]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
