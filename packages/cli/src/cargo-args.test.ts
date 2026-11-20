import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

describe('variance cargo', () => {
  it('records the suite named, passing what follows `--` to `cargo test`', () => {
    expect(parseArgs(['cargo', '--suite', 'native', '--', '-p', 'variance-sense'])).toEqual({ command: 'cargo', suite: 'native', args: ['-p', 'variance-sense'] });
  });

  it('names no suite when none is given, so the only declared one is meant', () => {
    expect(parseArgs(['cargo'])).toEqual({ command: 'cargo', args: [] });
  });
});
