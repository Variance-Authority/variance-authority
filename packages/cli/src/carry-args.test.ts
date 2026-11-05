import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from './args.js';
import { parseCarryArgs } from './carry-args.js';

describe('the arguments', () => {
  it('take the direction first, and refuse a third one', () => {
    const parse = (...argv: string[]) => parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format']));

    expect(parse('save', '--format', 'github')).toEqual({ command: 'carry', direction: 'save', format: 'github' });
    expect(() => parse()).toThrow('`carry` needs a direction: `restore` before the run, `save` after it, `take` and `keep` for a pull request\'s next push, or `hand` and `receive` for a run\'s other jobs');
    expect(() => parse('upload')).toThrow('`carry` restores, saves, takes, keeps, hands or receives, not `upload`');
    expect(parse('take')).toEqual({ command: 'carry', direction: 'take', format: 'text' });
    expect(parse('keep', 'here')).toEqual({ command: 'carry', direction: 'keep', dir: resolve('here'), format: 'text' });
    expect(() => parse('take', 'here', 'there')).toThrow('`carry take` takes no other argument, and was given `there`');
    expect(() => parse('save', 'here')).toThrow('`carry save` takes no other argument, and was given `here`');
    expect(() => parse('save', '--format', 'json')).toThrow('--format must be text or github');
  });

  it('name the directory the host moves between a run\'s jobs', () => {
    const parse = (...argv: string[]) => parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format']));

    expect(parse('hand', 'here', '--format', 'github')).toEqual({ command: 'carry', direction: 'hand', dir: resolve('here'), format: 'github' });
    expect(parse('receive', 'here')).toEqual({ command: 'carry', direction: 'receive', dir: resolve('here'), format: 'text' });
    expect(() => parse('hand')).toThrow('`carry hand` needs the directory the host moves between jobs');
    expect(() => parse('receive')).toThrow('`carry receive` needs the directory the host moves between jobs');
    expect(() => parse('receive', 'here', 'there')).toThrow('`carry receive` takes no other argument, and was given `there`');
  });
});
