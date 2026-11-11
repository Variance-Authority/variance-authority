import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from './args.js';
import { parseCarryArgs } from './carry-args.js';

describe('the arguments', () => {
  it('take the direction first, and refuse a third one', () => {
    const parse = (...argv: string[]) => parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format']));

    expect(parse('save', '--format', 'github')).toEqual({ command: 'carry', direction: 'save', format: 'github' });
    expect(() => parse()).toThrow('`carry` needs a direction: `restore` before the run, `save` after it, `take` and `keep` for a pull request\'s next push, `hand` and `receive` for a run\'s other jobs, or `merge` for a pull request\'s head');
    expect(() => parse('upload')).toThrow('`carry` restores, saves, takes, keeps, hands, receives or merges, not `upload`');
    expect(parse('take')).toEqual({ command: 'carry', direction: 'take', format: 'text' });
    expect(parse('keep', 'here')).toEqual({ command: 'carry', direction: 'keep', dir: resolve('here'), format: 'text' });
    expect(() => parse('take', 'here', 'there')).toThrow('`carry take` takes no other argument, and was given `there`');
    expect(() => parse('save', 'here')).toThrow('`carry save` takes no other argument, and was given `here`');
    expect(() => parse('save', '--format', 'json')).toThrow('--format must be text or github');
  });

  it("lay the last push as a shard's read only when taking it", () => {
    const parse = (...argv: string[]) => parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format', '--as-base']));

    expect(parse('take', 'here', '--as-base')).toEqual({ command: 'carry', direction: 'take', dir: resolve('here'), asBase: true, format: 'text' });
    expect(() => parse('keep', 'here', '--as-base')).toThrow('`--as-base` belongs to `carry take`, not `carry keep`');
  });

  it('name the directory the host moves between a run\'s jobs', () => {
    const parse = (...argv: string[]) => parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format']));

    expect(parse('hand', 'here', '--format', 'github')).toEqual({ command: 'carry', direction: 'hand', dir: resolve('here'), format: 'github' });
    expect(parse('receive', 'here')).toEqual({ command: 'carry', direction: 'receive', dir: resolve('here'), format: 'text' });
    expect(() => parse('hand')).toThrow('`carry hand` needs the directory the host moves between jobs');
    expect(() => parse('receive')).toThrow('`carry receive` needs the directory the host moves between jobs');
    expect(() => parse('receive', 'here', 'there')).toThrow('`carry receive` takes no other argument, and was given `there`');
  });

  it("name the record's commit a pull request's head is merged with, empty when there is none", () => {
    const parse = (...argv: string[]) =>
      parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format', '--head', '--on-conflict', '--expect'], ''));

    expect(parse('merge', 'abc', '--head', 'def', '--on-conflict', 'stay', '--expect', '123', '--format', 'github')).toEqual({
      command: 'carry',
      direction: 'merge',
      commit: 'abc',
      head: 'def',
      onConflict: 'stay',
      expect: '123',
      format: 'github',
    });
    // A workflow output that is empty: nothing to merge with, no head named, nothing to expect.
    expect(parse('merge', '', '--head', '', '--expect', '')).toEqual({ command: 'carry', direction: 'merge', commit: '', onConflict: 'fail', format: 'text' });
    expect(() => parse('merge')).toThrow("`carry merge` needs the record's commit, empty when the mainline has none");
    expect(() => parse('merge', 'abc', 'def')).toThrow('`carry merge` takes no other argument, and was given `def`');
    expect(() => parse('merge', 'abc', '--on-conflict', 'skip')).toThrow('--on-conflict must be stay or fail, not `skip`');
    expect(() => parse('save', '--head', 'def')).toThrow('`--head` belongs to `carry merge`, not `carry save`');
    expect(() => parse('hand', 'here', '--expect', '123')).toThrow('`--expect` belongs to `carry merge`, not `carry hand`');
  });
});
