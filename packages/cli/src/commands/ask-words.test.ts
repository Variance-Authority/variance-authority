import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import { describe, expect, it } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_OPERATOR } from '../exit.js';
import { parseArgs } from '../parse.js';

/**
 * A word after a question about the code is refused, where a flag it does not
 * take is named and answered past: a word is read as a report, and a report
 * changes what the question means.
 *
 * Every word after the question is a report path, and a question about the
 * checkout reads no report. `ask packages @kbn/does-not-exist` read as a
 * question about one package and answered every package with exit 0; `ask
 * search --query rule executor` read as a search for two words and searched
 * for one. Each of these is refused before the checkout is read, so no
 * repository is needed under the working directory.
 */

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('a word a question about the code does not take', () => {
  it('is refused after a question that takes nothing, naming the word and saying it takes none', async () => {
    for (const word of ['bogus', '@kbn/does-not-exist']) {
      const { code, out, err } = await run(['ask', 'packages', word]);

      expect(code).toBe(EXIT_OPERATOR);
      expect(out).toBe('');
      expect(err).toContain(`\`${word}\` is not an argument \`variance ask packages\` takes; it takes none`);
    }
  });

  it('is refused where the flag is answered past, each naming what the question takes', async () => {
    const flag = await run(['ask', 'packages', '--package', '@kbn/does-not-exist']);
    const word = await run(['ask', 'packages', '@kbn/does-not-exist']);

    // The flag is named and passed over before the checkout is read; with no
    // index here, what follows is the answer's own failure, not a refusal of it.
    expect(word.code).toBe(EXIT_OPERATOR);
    expect(flag.err).not.toContain('takes; it takes none');
    expect(flag.err).toContain(
      '`--package` is not an argument `variance ask packages` takes, so the answer is what it is without it; it takes none.',
    );
    expect(word.err).toContain('`@kbn/does-not-exist` is not an argument `variance ask packages` takes; it takes none.');
  });

  it('is taken as the value of an unknown flag before it, which is named with it', async () => {
    const { err } = await run(['ask', 'packages', '--limt', '5']);

    expect(err).not.toContain('`5` is not an argument');
    expect(err).toContain('`--limt 5` is not an argument `variance ask packages` takes, so the answer is what it is without it; it takes none.');
  });

  it('is not the value of an unknown flag when it asks for help', () => {
    // The help scan must not hand an unknown flag a value the lexer would not.
    expect(parseArgs(['ask', 'packages', '--verbose', '--help'])).toEqual({ command: 'help', topic: 'ask' });
  });

  it('is named beside the list of questions when no question was asked', async () => {
    const { code, out, err } = await run(['ask', '--verbose']);

    expect(code).toBe(0);
    expect(out).toContain('ABOUT THE LAST RUN');
    expect(err).toContain('variance: `--verbose` is not an argument `variance ask` takes, so the list of questions is what it is without it; a flag goes after its question.');
  });

  it('is refused after a flag value that ran on past one word, naming what the question takes', async () => {
    const { code, err } = await run(['ask', 'search', '--query', 'rule', 'executor']);

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('`executor` is not an argument `variance ask search` takes; it takes --query');
    expect(err).toContain('A value of more than one word is one argument, in quotes.');
  });
});

describe('a word a question about a running suite does not take', () => {
  it('is refused before the missing watcher, which a corrected question is still told about', async () => {
    // Only a watcher answers `run-signals`, and a watcher reads no report.
    // Named first, because it is wrong whether or not a watcher is running.
    const root = await mkdtemp(join(tmpdir(), 'va-ask-words-'));
    const config = join(root, 'variance.config.json');
    await writeFile(config, JSON.stringify({
      project: 'ask-words',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['cart/empty'], collector: './collector.mjs' },
      fonts: [],
      report: '.variance/report.json',
    }), 'utf8');
    const exported = process.env[VANTAGE_VARIABLE];
    delete process.env[VANTAGE_VARIABLE];
    try {
      const word = await run(['ask', 'run-signals', 'bogus', '--config', config]);
      const corrected = await run(['ask', 'run-signals', '--config', config]);

      expect(word.code).toBe(EXIT_OPERATOR);
      expect(word.err).toContain('`bogus` is not an argument `variance ask run-signals` takes; it takes');
      expect(corrected.code).toBe(EXIT_OPERATOR);
      expect(corrected.err).toContain('needs a watcher to ask');
    } finally {
      if (exported !== undefined) process.env[VANTAGE_VARIABLE] = exported;
    }
  });
});
