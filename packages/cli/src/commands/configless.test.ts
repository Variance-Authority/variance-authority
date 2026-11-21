import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { questions } from './ask-questions.js';

/**
 * The answers that need no config, asked where there is none: a directory
 * with no `variance.config.json` and no checkout.
 */

const cwd = process.cwd();

afterEach(() => {
  vi.unstubAllEnvs();
  process.chdir(cwd);
});

async function answer(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  process.chdir(realpathSync(mkdtempSync(join(tmpdir(), 'va-configless-'))));
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('an answer that needs no config', () => {
  it('lists the questions `ask` answers, for `ask` with no question', async () => {
    expect(await answer(['ask'])).toEqual({ code: EXIT_CLEAN, out: questions(), err: '' });
  });

  it.each([
    ['--to', 'src/entry.ts'],
    ['--query', 'token'],
    ['--imports', 'module#name'],
    ['--declarations'],
    ['--changed-file', 'missing.txt'],
    ['--taint-file', 'missing.json'],
    ['--format', 'json'],
    ['--at', 'missing-watcher'],
    ['--verbose'],
  ])('refuses question arguments without a question: %s', async (...args) => {
    const { code, out, err } = await answer(['ask', ...args]);
    expect(code).toBe(EXIT_OPERATOR);
    expect(out).toBe('');
    expect(err).toContain('`variance ask` needs a question before its arguments.');
    expect(err).toContain('`variance ask <question> ...`');
    expect(err).toContain('run `variance ask` to list questions');
    expect(err).not.toContain('could not read');
  });

  it('keeps explicit help and the config-independent catalogue', async () => {
    const help = await answer(['ask', '--to', 'src/entry.ts', '--help']);
    expect(help.code).toBe(EXIT_CLEAN);
    expect(help.err).toBe('');
    expect(help.out).toContain('variance ask');
    expect(await answer(['ask', '--config', 'missing.json'])).toEqual({ code: EXIT_CLEAN, out: questions(), err: '' });
  });

  it('asks a watcher what only a watcher answers, where no project was ever configured', async () => {
    // A shell that exports a watcher's address would answer from it.
    vi.stubEnv('VARIANCE_AUTHORITY_VANTAGE', undefined);
    const { err } = await answer(['ask', 'ran']);
    expect(err).toContain('needs a watcher to ask');
    expect(err).not.toContain('variance.config.json');
  });
});
