/// <depends path="./__fixtures__/names" />
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tree } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { ask } from './ask.js';
import { refreshDependencyLexicon } from './dependency-lexicon.js';
import { readWorkspace, readWorkspaceForAnswer } from './read.js';
import { questionsOf } from '../../../tools/name-questions.mjs';

/**
 * The name questions, asked as `variance ask` asks them of the store and
 * the source index a workspace publishes, answer what
 * they answered when `__fixtures__/names/name.answers` was kept: a name in each
 * way one is exported, a member, a nested one and one nobody declares, then the
 * words, the packages, an entrypoint and the gaps. A change to how the store is
 * laid out or read leaves every answer as it was.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/names');

const cache = process.env['VARIANCE_AUTHORITY_CACHE'];
let temporary: string;
let root: string;
let help: Help;
let tree: Tree | undefined;

/** One question's answer, or what it refused with, under its own heading. */
function answered(question: readonly string[]): string {
  const [verb = '', ...args] = question;
  let text: string;
  try {
    text = ask(help, verb, args, () => tree, root, true);
  } catch (refused) {
    text = `refused: ${(refused as Error).message}`;
  }
  return `## ${question.join(' ')}\n${text.replace(/^Snapshot .*$/gm, 'Snapshot <masked>')}\n`;
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'help-names-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(temporary, 'cache');
  root = join(temporary, 'workspace');
  await cp(FIXTURE, root, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  await updateSourceIndex(root);
  await refreshDependencyLexicon(root);
  await readWorkspace(root);
  help = await readWorkspaceForAnswer(root, { justAnswer: true, tree: (drawn) => { tree = drawn; } });
});

afterAll(async () => {
  if (cache === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  await rm(temporary, { recursive: true, force: true });
});

describe('the name questions, from the published store', () => {
  it('answer the kept set as they were kept', async () => {
    const questions = questionsOf(await readFile(join(FIXTURE, 'name.questions'), 'utf8'));
    expect(questions.length).toBeGreaterThanOrEqual(25);
    await expect(questions.map(answered).join('\n')).toMatchFileSnapshot(join(FIXTURE, 'name.answers'));
  });
});
