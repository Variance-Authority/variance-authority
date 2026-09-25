import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

/**
 * What `reach` refuses on the command line, before a repository is touched.
 *
 * Every one of these is the same refusal wearing a different coat: the command
 * prints a list somebody substitutes into a runner, so an argument it had to
 * guess about would be a guess a suite is run from. `--since` has no default for
 * that reason and the parser is where it is enforced, which is the only place it
 * can be enforced before a scan has cost anything.
 */
describe('what reach is asked for', () => {
  it.each(['reach', 'select'])('%s accepts filesystem graph discovery', (command) => {
    expect(parseArgs([command, '--since', 'main', '--no-git'])).toMatchObject({
      command,
      noGit: true,
    });
  });

  it('refuses without a ref, and says what the alternative would have been', () => {
    expect(() => parseArgs(['reach'])).toThrow(/every file in the checkout/);
  });

  it('refuses an empty ref, which a shell produces from an unset variable', () => {
    // `variance reach --since $BASE` with `BASE` unset. Treated as "not given"
    // rather than as a ref named nothing, because git would answer the second.
    expect(() => parseArgs(['reach', '--since', ''])).toThrow(/needs `--since <ref>`/);
  });

  it('takes plain and json, and nothing else', () => {
    expect(parseArgs(['reach', '--since', 'main'])).toEqual({
      command: 'reach',
      since: 'main',
      format: 'plain',
    });
    expect(parseArgs(['reach', '--since', 'main', '--format', 'json']).format).toBe('json');
    expect(() => parseArgs(['reach', '--since', 'main', '--format', 'vitest'])).toThrow(
      /--format must be plain or json/,
    );
  });

  it('takes --whole-files, and leaves it out when not given', () => {
    expect(parseArgs(['reach', '--since', 'main', '--whole-files'])).toMatchObject({ wholeFiles: true });
    expect(parseArgs(['reach', '--since', 'main'])).not.toHaveProperty('wholeFiles');
  });

  it('reads no configuration, so --config is not one of its flags', () => {
    // The fact `CONFIGLESS` states from the other side. A repository whose tests
    // another runner runs has no `variance.config.json`, and offering a flag
    // that would be ignored is worse than refusing it.
    expect(() => parseArgs(['reach', '--since', 'main', '--config', 'v.json'])).toThrow(
      /--config/,
    );
  });
});
