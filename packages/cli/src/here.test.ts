import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { said } from './here.js';

describe('a path said from where the reader is', () => {
  it('drops the part about whose machine it is', () => {
    expect(said(resolve(process.cwd(), 'variance.config.json'))).toBe('variance.config.json');
    expect(said(resolve(process.cwd(), 'node_modules/@variance-authority/cli/skill/SKILL.md'))).toBe(
      'node_modules/@variance-authority/cli/skill/SKILL.md',
    );
  });

  it('stays absolute for somewhere else entirely', () => {
    // A cache under a home directory, a report in a temporary directory, a
    // globally installed package. Counting `..` hops to reach one is not a path
    // anybody can act on, and being elsewhere is the thing worth saying.
    const elsewhere = resolve(tmpdir(), 'somewhere/coverage.bin');

    expect(said(elsewhere)).toBe(elsewhere);
  });

  it('leaves the working directory itself alone', () => {
    // `relative` calls it the empty string, which names nothing.
    expect(said(process.cwd())).toBe(process.cwd());
  });
});
