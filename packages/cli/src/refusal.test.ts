import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, parseArgs } from './bin.js';
import { EXIT_OPERATOR, OperatorError } from './exit.js';
import { SKILL_NAME, skillPath } from './skill.js';

/**
 * What a refusal is worth to whoever has to act on it.
 *
 * Its own file because the reader is the subject, not the parser: `bin.test.ts`
 * asks whether the right things are refused, and these ask what a reader can do
 * with a refusal once it arrives. Most of them are agents, and every line they
 * have to read past, and every name they have to guess at, is a turn.
 */

/**
 * What a refusal says besides what went wrong.
 *
 * Most callers here are agents, and the one shipped document that says which
 * question to ask and what each needs is installed beside the command they just
 * ran. An agent cannot read a file nobody named, so every refusal names it.
 */
describe('the skill, after a refusal', () => {
  it('names the shipped skill from where the command was run', async () => {
    const said = await refusal();
    // What an installed consumer sees is `node_modules/@variance-authority/…`,
    // which is a path they can open and a path that still means something in a
    // log. The absolute one names whose machine it was.
    expect(said).toContain(relative(process.cwd(), skillPath()!));
    expect(said).toContain(SKILL_NAME);
    expect(said).not.toContain(skillPath());
  });

  it('names it absolutely from somewhere the file is not under', async () => {
    // A global install, or a caller standing outside the checkout. Counting
    // `..` hops through directories nobody named is not an instruction.
    const here = process.cwd();
    try {
      process.chdir(tmpdir());
      expect(await refusal()).toContain(skillPath());
    } finally {
      process.chdir(here);
    }
  });

  it('points at a file that is there, whichever way it is spelled', async () => {
    // A path printed for a file a consumer did not publish is worse than no
    // line: the reader spends a call on it and learns nothing.
    const said = /skill at (.+)/.exec(await refusal())?.[1] ?? '';

    expect(said).not.toBe('');
    expect(isAbsolute(said) || existsSync(resolve(process.cwd(), said))).toBe(true);
    expect(existsSync(skillPath()!)).toBe(true);
  });
});

/** What a refused command writes to its error stream. */
async function refusal(argv: readonly string[] = ['ask', '--not-a-flag']): Promise<string> {
  const errors: string[] = [];
  const code = await main(argv, { out: () => {}, err: (text) => errors.push(text) });

  expect(code).toBe(EXIT_OPERATOR);
  return errors.join('');
}

/**
 * What a refusal costs the reader who has to act on it.
 *
 * A person reads the accepted set and picks the name they meant. An agent spends
 * a turn on that, and spends it again for every line it has to read past — so a
 * refusal names the nearest candidate, and shows the shape of the command that
 * was actually run rather than all fifteen.
 */
describe('recovering from a typo', () => {
  it('names the command that was probably meant', () => {
    expect(attempt(['aks']).message).toContain('Did you mean `ask`?');
  });

  it('names the flag that was probably meant', () => {
    expect(attempt(['ask', '--quer', 'warning']).message).toContain('Did you mean `--query`?');
  });

  it('suggests nothing for a word that is not a typo of anything', () => {
    expect(attempt(['elephant']).message).not.toContain('Did you mean');
  });

  it('names the question that was probably meant, before it opens anything', async () => {
    // The name of a question is a fact about this tool, not about the project.
    // Answering a mistyped one with "cannot read the configuration" sends the
    // reader to fix a file that was never the problem.
    const errors: string[] = [];
    const code = await main(['ask', 'locat', '--config', '/nowhere/variance.config.json'], {
      out: () => {},
      err: (text) => errors.push(text),
    });

    expect(code).toBe(EXIT_OPERATOR);
    expect(errors.join('')).toContain('`locat` is not a question');
    expect(errors.join('')).toContain('Did you mean `locate`?');
    expect(errors.join('')).not.toContain('/nowhere/variance.config.json');
  });

  it('shows the shape of the command that was run, and not the other fourteen', () => {
    const message = attempt(['ask', '--quer', 'warning']).message;

    expect(message).toContain('variance ask     [--config <path>]');
    expect(message).not.toContain('variance distill');
  });
});

function attempt(argv: readonly string[]): OperatorError {
  try {
    parseArgs(argv);
  } catch (error) {
    if (error instanceof OperatorError) return error;
    throw error;
  }
  throw new Error(`expected \`${argv.join(' ')}\` to be refused`);
}
