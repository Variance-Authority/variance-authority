import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

const parse = (...argv: string[]) => parseArgs(['janus', ...argv]);

describe('`janus` arguments', () => {
  it('takes the ref and the command after `--`, flags and all', () => {
    expect(parse('--since', 'main', '--', 'npx', 'vitest', '--run')).toEqual({ command: 'janus', since: 'main', run: ['npx', 'vitest', '--run'] });
  });

  it('refuses a run with no ref, or no command', () => {
    expect(() => parse('--', 'npx', 'vitest')).toThrow('needs --since');
    expect(() => parse('--since', 'main')).toThrow('needs a command');
  });
});
