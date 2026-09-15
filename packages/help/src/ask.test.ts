import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { ask, inputFrom, toolNamed, verbOf, verbs } from './ask.js';
import { HELP_TOOLS } from './tools.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');
const READING = readHelp(WORKSPACE);

describe('a verb is a tool, not a second implementation of one', () => {
  it('names every tool the server lists, with the wire prefix dropped', () => {
    expect(verbs().map(([verb]) => verb)).toEqual(['packages', 'entrypoint', 'symbol', 'uses', 'search', 'gaps']);
  });

  it('dispatches to the same value the server would have called', () => {
    for (const tool of HELP_TOOLS) expect(toolNamed(verbOf(tool))).toBe(tool);
  });

  it('answers a verb with exactly what the tool answers', () => {
    const tool = toolNamed('search');
    expect(ask(READING, 'search', ['deep'])).toBe(tool.run(READING, { query: 'deep' }));
  });

  it('names what it answers when a verb is not one of them', () => {
    // A model handed "unknown verb" has one move left, which is to guess again.
    expect(() => toolNamed('symbols')).toThrow(/packages, entrypoint, symbol, uses, search, gaps/);
  });
});

describe('arguments, read off the schema the tool already publishes', () => {
  it('fills the first property from a bare word, so the common question is the short one', () => {
    expect(inputFrom(toolNamed('search'), ['viewport'])).toEqual({ query: 'viewport' });
  });

  it('takes the properties by name, in any order', () => {
    expect(inputFrom(toolNamed('uses'), ['--from', 'a/b.ts', '--name', 'deep'])).toEqual({
      name: 'deep',
      from: 'a/b.ts',
    });
  });

  it('fills bare words in schema order', () => {
    expect(inputFrom(toolNamed('entrypoint'), ['alpha', './deep'])).toEqual({
      package: 'alpha',
      subpath: './deep',
    });
  });

  it('refuses a misspelled flag rather than ignoring it', () => {
    // Every property of `uses` but one is optional, so an ignored typo would
    // answer with a plausible ranking by nothing and read like a repository
    // where nothing is written near you.
    expect(() => inputFrom(toolNamed('uses'), ['deep', '--form', 'a/b.ts'])).toThrow(
      /takes no `--form`; it takes: name, package, from/,
    );
  });

  it('refuses a flag given no value', () => {
    expect(() => inputFrom(toolNamed('uses'), ['--from'])).toThrow(/given no value/);
  });

  it('refuses an argument to a verb that takes none', () => {
    expect(() => inputFrom(toolNamed('gaps'), ['alpha'])).toThrow(/takes no argument `alpha`/);
  });
});
