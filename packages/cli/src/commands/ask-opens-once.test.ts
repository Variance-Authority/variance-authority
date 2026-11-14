import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readWorkspaceForAnswer } from '@variance-authority/help';
import { HELP } from '@variance-authority/help/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * How many times one question opens the source index: the calls that hand the
 * addon the chain's path, each of which reads and hashes every segment. A name
 * declared in several files is read once per declaration, and every one of
 * those reads used to open the chain again. A question is answered where the
 * shell answers it, so each way in is asked here: the command, `search`, which
 * answers from its own published file, as text and as data, and the server.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-opens-once-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const declared = (file: string) => `export function levyOf(amount: number): number {\n  return amount / ${file.length};\n}\n`;

const LEVIES = {
  'packages/kit/src/vat.ts': declared('vat'),
  'packages/kit/src/duty.ts': declared('duty'),
  'packages/kit/src/money/levy.ts': declared('levy'),
};

/** The addon the source package loaded, the same object its readers call into. */
async function addon(): Promise<Record<string, unknown>> {
  const sense = fileURLToPath(import.meta.resolve('@variance-authority/sense'));
  const { native } = (await import(pathToFileURL(join(dirname(sense), 'addon.js')).href)) as { native: () => Record<string, unknown> | undefined };
  return native()!;
}

/** Every call into the addon handed the source index's path, counted while `ask` runs. */
async function opensOf(ask: () => unknown): Promise<number> {
  const scanner = await addon();
  const path = sourceIndexPath(process.cwd());
  const kept = new Map<string, unknown>();
  let opens = 0;
  for (const [name, call] of Object.entries(scanner)) {
    if (typeof call !== 'function') continue;
    kept.set(name, call);
    scanner[name] = function (this: unknown, ...args: unknown[]) {
      if (args.includes(path)) opens += 1;
      return (call as (...args: unknown[]) => unknown).apply(this, args);
    };
  }
  try {
    await ask();
  } finally {
    for (const [name, call] of kept) scanner[name] = call;
  }
  return opens;
}

/** `argv` run, which must answer, and how many times it opened the index. */
async function opensAsking(argv: readonly string[]): Promise<number> {
  let answered: Awaited<ReturnType<typeof run>> | undefined;
  const opens = await opensOf(async () => { answered = await run(argv); });
  expect(answered?.err).toBe('');
  expect(answered?.code).toBe(EXIT_CLEAN);
  expect(answered?.out).toContain('levyOf');
  return opens;
}

describe('one question about a name declared in several files', () => {
  beforeEach(async () => {
    checkout(LEVIES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('opens the source index once for `ask symbol`', async () => {
    expect(await opensAsking(['ask', 'symbol', '--name', 'levyOf', '--just-answer'])).toBe(1);
  });

  it('opens the source index once for `ask search`', async () => {
    expect(await opensAsking(['ask', 'search', '--query', 'levyOf', '--just-answer'])).toBe(1);
  });

  it('opens the source index once for `ask search` as data', async () => {
    expect(await opensAsking(['ask', 'search', '--query', 'levyOf', '--just-answer', '--format', 'json'])).toBe(1);
  });

  it('opens the source index once for the served `docs_symbol`', async () => {
    const root = process.cwd();
    const help = await readWorkspaceForAnswer(root);
    const served = HELP.tools.find((tool) => tool.name === 'docs_symbol')!;
    let answer = '';
    const opens = await opensOf(() => { answer = served.run(help, { name: 'levyOf' }, { root }); });
    expect(answer).toContain('levyOf');
    expect(opens).toBe(1);
  });
});
