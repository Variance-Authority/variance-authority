import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

const parse = (...argv: string[]) => parseArgs(['janus', ...argv]);

describe('`janus` arguments', () => {
  it('takes the ref, each file to roll back, and the command after `--`, flags and all', () => {
    expect(parse('--since', 'main', '--file', 'a.test.js', '--file', 'b.test.js', '--', 'npx', 'vitest', '--run')).toEqual({
      command: 'janus',
      since: 'main',
      files: ['a.test.js', 'b.test.js'],
      run: ['npx', 'vitest', '--run'],
    });
  });

  it('refuses a run with no ref, no file, or no command', () => {
    expect(() => parse('--file', 'a.test.js', '--', 'npx', 'vitest')).toThrow('needs --since');
    expect(() => parse('--since', 'main', '--', 'npx', 'vitest')).toThrow('needs --file');
    expect(() => parse('--since', 'main', '--file', 'a.test.js')).toThrow('needs a command');
  });
});
