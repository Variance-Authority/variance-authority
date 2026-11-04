import { describe, expect, it } from 'vitest';
import { invocation, leaks, sealed } from './codex-review.mjs';

/**
 * A Codex review counts only when it knew nothing but the pull request. What
 * it could learn from its environment, and what its log shows it did learn,
 * are the two sides of that.
 */
describe('the Codex run', () => {
  it('is asked for the review and nothing else', () => {
    expect(invocation('https://github.com/o/r/pull/1', '/tmp/r/out.md').at(-1)).toBe('review https://github.com/o/r/pull/1');
  });

  it('ignores the configuration, rules, plugins and apps of whoever started it', () => {
    const args = invocation('u', 'o');
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--ephemeral']));
    expect(args.filter((_, i) => args[i - 1] === '--disable')).toEqual(['plugins', 'apps']);
  });

  it('holds no credential, temporary directory or agent variable', () => {
    const env = sealed('/tmp/r/home', '/Users/me/.codex');
    expect(Object.keys(env).sort()).toEqual(['CODEX_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'HOME', 'PATH']);
    expect(env.HOME).toBe('/tmp/r/home');
  });
});

describe('the leak check', () => {
  it('names each place of ours the log mentions', () => {
    const log = '{"command":"cat /Users/me/dev/repo/AGENTS.md"}';
    expect(leaks(log, ['/Users/me/dev/repo', '/tmp/scratch'])).toEqual(['/Users/me/dev/repo']);
  });

  it('passes a log that read the repository from the pull request', () => {
    expect(leaks('{"command":"cat /tmp/review-x/work/repo/AGENTS.md"}', ['/Users/me/dev/repo'])).toEqual([]);
  });
});
