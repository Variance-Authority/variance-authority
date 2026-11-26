/// <depends path="../bin.ts" />
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { nativeFiles } from './ask-native.fixture.js';
import { checkout, run } from './ask-packages.fixture.js';

const manifest = new URL('../../package.json', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { variance: string } };
const executable = fileURLToPath(new URL(bin.variance, manifest));
const nodeEntry = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const repository = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '');

/**
 * What each question is answered with: recorded from the TypeScript tools before the answers moved to Rust, but
 * for an import the index resolved to no file (`lost`, `Schedule`, `Cadence`), now listed apart rather than credited
 * by its package's name, and an export bound to no declaration (`unbound`), now refused saying so.
 */
const recorded = JSON.parse(readFileSync(new URL('./ask-native-names.expected.json', import.meta.url), 'utf8')) as Record<string, readonly [number, string, string]>;

/** What differs between runs: the checkout's path, this repository's, the cache's and the snapshot's time. */
function steady(root: string, text: string): string {
  return text.replaceAll(root, '<root>').replaceAll(repository, '<repo>').replace(/[^\s']*\/test-selection\/[0-9a-f]+\//gu, '<cache>/').replace(/Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z/gu, 'Snapshot <time>');
}

it.each(([
  ['symbol', '--name', 'greet'],
  ['symbol', '--name', 'greet', '--package', '@acme/lib'],
  ['symbol', '--name', 'shared', '--package', '@acme/lib-exports'],
  ['symbol', '--name', 'addTax', '--package', '@acme/lib/src/internal/math'],
  ['symbol', '--name', 'dualExport', '--package', '@acme/dual/tools'],
  ['symbol', '--name', 'wholeExport', '--package', '@acme/whole'],
  ['symbol', '--name', '値', '--package', '@acme/lib'],
  ['symbol', '--name', 'externalOnly', '--package', 'search-kit'],
  ['symbol', '--name', 'greet', '--package', '@acme/kit'],
  ['symbol', '--name', 'taxOf'],
  ['symbol', '--name', 'shared'],
  ['symbol', '--name', '値'],
  ['symbol', '--name', '値', '--limit', '1'],
  ['symbol', '--name', 'unknownExactName'],
  ['symbol', '--name', 'taxOf, unknownExactName, greet, taxOf'],
  ['symbol', '--limit=1', '--name=unknownExactName,anotherMissingName'],
  ['symbol', '--name', 'sessionToken', '--limit', '1'],
  ['symbol', '--name', 'AgentSession.sessionToken'],
  ['symbol', '--name', 'externalOnly'],
  ['symbol', '--name', 'boundOnly'],
  ['symbol', '--name', 'boundOnly', '--limit', '1'],
  ['symbol', '--name', 'boundToo'],
  ['symbol', '--name', 'boundExport'],
  ['symbol', '--name', 'boundModule', '--package', '@acme/lib'],
  ['symbol', '--name', 'CabinetLedger'],
  ['uses', '--name', 'greet'],
  ['uses', '--name', 'greet', '--package', '@acme/lib'],
  ['uses', '--name', 'shared', '--package', '@acme/lib-exports'],
  ['uses', '--name', 'addTax', '--package', '@acme/lib/src/internal/math'],
  ['uses', '--name', 'dualExport', '--package', '@acme/dual/tools'],
  ['uses', '--name', 'greet', '--package', '@acme/kit'],
  ['uses', '--name=greet', '--from=packages/lib/src', '--limit=1'],
  ['uses', '--name', 'shared'],
  ['uses', '--name', 'shared', '--file', 'packages/lib-exports/src/index.ts'],
  ['uses', '--name', 'greet', '--file', 'packages/lib/src/index.ts'],
  ['uses', '--name', 'taxOf'],
  ['uses', '--name', 'orphan'],
  ['uses', '--name', '値'],
  ['uses', '--name', '値', '--file', 'packages/lib/src/private.ts'],
  ['uses', '--name', 'unknownExactName'],
  ['uses', '--name', 'boundOnly'],
  ['uses', '--name', 'boundToo'],
  ['uses', '--name', 'boundModule'],
  ['uses', '--name', 'boundToo', '--file', 'packages/lib/src/bound-a.js'],
  ['uses', '--name', 'sessionToken'],
  ['uses', '--name', 'AgentSession.sessionToken', '--from', 'packages/lib/src/session.ts'],
  ['symbol', '--name', 'twinName'],
  ['symbol', '--name', 'relayed'],
  ['symbol', '--name', 'KitShape'],
  ['symbol', '--name', 'KitBox'],
  ['symbol', '--name', 'unusedRate'],
  ['symbol', '--name', 'orphan'],
  ['uses', '--name', 'twinName'],
  ['uses', '--name', 'twinName', '--file', 'packages/lib-exports/src/twin.ts'],
  ['uses', '--name', 'twinName', '--from', 'packages/lib-exports/src'],
  ['uses', '--name', 'twinName', '--limit', '1'],
  ['symbol', '--name', 'twinName', '--limit', '1'],
  ['uses', '--name', 'relayed', '--package', '@acme/lib'],
  ['uses', '--name', 'relayed'],
  ['uses', '--name', 'Frame'],
  ['uses', '--name', 'Frame', '--file', 'packages/lib-exports/src/frame.ts'],
  ['uses', '--name', 'Panel'],
  ['uses', '--name', 'runJob'],
  ['uses', '--name', 'zoomIn'],
  ['uses', '--name', 'DeleteRequest'],
  ['uses', '--name', 'MetricsRequest'],
  ['uses', '--name', 'mockOnly'],
  ['symbol', '--name', 'mockOnly'],
  ['symbol', '--name', 'Panel'],
  ['uses', '--name', 'Panel', '--limit', '1'],
  ['uses', '--name', 'stepAll'],
  ['uses', '--name', 'greet', '--package', '@acme/lib-exports'],
  ['symbol', '--name', 'greet', '--package', '@acme/lib-exports'],
  ['uses', '--name', 'heldFoo', '--file', 'packages/lib/src/held.ts'],
  ['uses', '--name', 'PutRequest'],
  ['symbol', '--name', 'PutRequest'],
  ['symbol', '--name', 'greet', '--from', 'apps/app/src/hello.ts'],
  ['symbol', '--name', '値', '--from', 'packages/lib/src/private.ts'],
  ['symbol', '--name', 'greet', '--line', 'apps/app/src/hello.ts:2'],
  ['symbol', '--name', 'ledgerCode', '--limit', '1'],
  ['symbol', '--name', 'default'],
  ['symbol', '--name', 'hello'],
  ['symbol', '--name', 'loose'],
  ['symbol', '--name', 'KitBox.nothing'],
  ['symbol', '--name', 'size'],
  ['symbol', '--name', 'wave'],
  ['symbol', '--name', 'lost'],
  ['symbol', '--name', 'crowdedPath', '--limit', '2'],
  ['uses', '--name', 'crowdedPath', '--file', 'packages/kit/src/crowd.ts'],
  ['symbol', '--name', 'Schedule'],
  ['symbol', '--name', 'Cadence'],
  ['symbol', '--name', 'keptOf'],
  ['symbol', '--name', 'absentIndex'],
  ['uses', '--name', 'default'],
  ['uses', '--name', 'hello'],
  ['uses', '--name', 'loose'],
  ['uses', '--name', 'KitBox.nothing'],
  ['uses', '--name', 'size'],
  ['uses', '--name', 'size', '--file', 'nope.ts'],
  ['uses', '--name', 'open'],
  ['uses', '--name', 'wave'],
  ['uses', '--name', 'wave', '--package', '@acme/sea'],
  ['uses', '--name', 'lost'],
  ['uses', '--name', 'Schedule'],
  ['uses', '--name', 'lost', '--file', 'packages/kit/src/lost.ts'],
  ['uses', '--name', 'twinName', '--file', 'packages/lib/src/twins.ts'],
  ['uses', '--name', 'greet', '--limit', '1'],
  ['uses', '--name', 'keptOf'],
  ['uses', '--name', 'absentIndex'],
  ['uses', '--name', 'unbound', '--file', 'packages/kit/src/relay.ts'],
] as readonly (readonly string[])[]).map((question) => ({ question })) as readonly { question: readonly string[] }[])('answers $question through both entries as the TypeScript tools did', async ({ question }) => {
  const previous = process.cwd();
  const root = checkout(nativeFiles(question));
  try {
    // `absentIndex` is asked before any index exists; `keptOf` is written after the index was.
    if (question[2] !== 'absentIndex') expect((await run(['index', '--wait'])).code).toBe(0);
    if (question[2] === 'keptOf') writeFileSync(join(root, 'packages/kit/src/kept.ts'), 'export function keptOf(): number { return 1; }\n');
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const env = { ...process.env, npm_config_user_agent: '' };
    const args = ['ask', ...question];
    const answers = [
      spawnSync(process.execPath, [nodeEntry, ...args], { cwd: root, env, encoding: 'utf8' }),
      spawnSync(executable, args, { cwd: root, env: { ...env, PATH: empty }, encoding: 'utf8' }),
    ].map((answer) => [answer.status, steady(root, answer.stdout), steady(root, answer.stderr)]);
    expect(answers).toEqual([recorded[question.join(' ')], recorded[question.join(' ')]]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses a name question with GIT_DIR set, saying why, rather than handing it to Node', async () => {
  const previous = process.cwd();
  const root = checkout(nativeFiles(['symbol', '--name', 'greet']));
  try {
    expect((await run(['index', '--wait'])).code).toBe(0);
    const empty = join(root, 'empty-path');
    mkdirSync(empty);
    const answers = (['symbol', 'uses'] as const).map((question) => {
      const answer = spawnSync(executable, ['ask', question, '--name', 'greet'], {
        cwd: root, env: { ...process.env, PATH: empty, GIT_DIR: join(root, '.git'), npm_config_user_agent: '' }, encoding: 'utf8',
      });
      return [answer.status, answer.stdout, steady(root, answer.stderr)];
    });
    const why = 'variance: the source index of this checkout cannot be found: GIT_DIR or GIT_WORK_TREE is set, so the checkout git reads may not be the one the working directory is in; unset them to ask from here.\n\nSee the skill at <repo>/packages/cli/skills/variance-authority/SKILL.md\n';
    expect(answers).toEqual([[2, '', why], [2, '', why]]);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
