import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

describe('variance cargo', () => {
  it('records the suite named, passing what follows `--` to `cargo test`', () => {
    expect(parseArgs(['cargo', '--suite', 'native', '--', '-p', 'variance-sense'])).toEqual({ command: 'cargo', suite: 'native', args: ['-p', 'variance-sense'] });
  });

  it('refuses what follows a second `--`, since every test runs and is recorded', () => {
    expect(() => parseArgs(['cargo', '--', '--lib', '--', 'adds'])).toThrow(/runs every test/);
  });

  it('refuses a test filter, which `cargo test` would hand the tests, and takes the values of its own options', () => {
    expect(() => parseArgs(['cargo', '--', '--lib', 'adds'])).toThrow(/takes no test filter: adds/);
    expect(parseArgs(['cargo', '--', '-p', 'calc', '--features', 'fast', '--test=negates', '--test', 'aborts'])).toEqual({ command: 'cargo', args: ['-p', 'calc', '--features', 'fast', '--test=negates', '--test', 'aborts'] });
  });

  it('names no suite when none is given, so the only declared one is meant', () => {
    expect(parseArgs(['cargo'])).toEqual({ command: 'cargo', args: [] });
  });
});
