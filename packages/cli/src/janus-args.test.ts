import { describe, expect, it } from 'vitest';
import { readFlags } from './args.js';
import { parseJanusArgs } from './janus-args.js';
import { flagsFor, synopsisFor } from './usage.js';

const parse = (...argv: string[]) => parseJanusArgs(readFlags(argv, 'janus', flagsFor('janus'), synopsisFor('janus')));

describe('`janus` arguments', () => {
  it('takes the ref and the command after `--`, flags and all', () => {
    expect(parse('--since', 'main', '--', 'npx', 'vitest', '--run')).toEqual({ command: 'janus', since: 'main', run: ['npx', 'vitest', '--run'] });
  });

  it('refuses a run with no ref, or no command', () => {
    expect(() => parse('--', 'npx', 'vitest')).toThrow('needs --since');
    expect(() => parse('--since', 'main')).toThrow('needs a command');
  });
});
