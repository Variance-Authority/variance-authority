import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
import { questions } from './ask-questions.js';
import { COMMENT_MARKER } from './comment.js';

/**
 * The answers that need no config, asked where there is none: a directory
 * with no `variance.config.json` and no checkout.
 */

const cwd = process.cwd();

afterEach(() => {
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
  it('prints the marker a docket comment is found by, for `comment --marker`', async () => {
    expect(await answer(['comment', '--marker'])).toEqual({ code: EXIT_CLEAN, out: `${COMMENT_MARKER}\n`, err: '' });
  });

  it('lists the questions `ask` answers, for `ask` with no question', async () => {
    expect(await answer(['ask'])).toEqual({ code: EXIT_CLEAN, out: questions(), err: '' });
  });
});
