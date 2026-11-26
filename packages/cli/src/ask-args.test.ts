import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from './args.js';
import { parseAskArgs } from './ask-args.js';
import { parseArgs } from './parse.js';
import { flagsFor, synopsisFor } from './usage.js';

describe('source refresh input', () => {
  it('resolves the authoritative changed-file list', () => {
    const flags = readFlags(
      ['search', '--query', 'button', '--changed-file', 'changed.txt', '--taint-file', 'loaders.json'],
      'ask',
      flagsFor('ask'),
      synopsisFor('ask'),
    );

    expect(parseAskArgs(flags, resolve('variance.config.json'))).toMatchObject({
      question: 'search',
      query: 'button',
      changedFile: resolve('changed.txt'),
      taintFile: resolve('loaders.json'),
    });
  });
});

describe('the sets discover crosses', () => {
  it('reads each by its own flag, and its `--except-` twin beside it', () => {
    const flags = readFlags(
      [
        'discover', '--from', 'src/TopNav.tsx', '--imports', 'react#createContext', '--declares', 'theme|user',
        '--path', 'src/', '--text', 'dark', '--except-from', 'a.ts', '--except-to', 'b.ts',
        '--except-imports', 'c', '--except-declares', 'd', '--except-path', 'e',
      ],
      'ask',
      flagsFor('ask'),
      synopsisFor('ask'),
    );

    expect(parseAskArgs(flags, resolve('variance.config.json'))).toMatchObject({
      question: 'discover',
      from: 'src/TopNav.tsx',
      imports: 'react#createContext',
      declares: 'theme|user',
      path: 'src/',
      text: 'dark',
      exceptFrom: 'a.ts',
      exceptTo: 'b.ts',
      exceptImports: 'c',
      exceptDeclares: 'd',
      exceptPath: 'e',
    });
  });
});

describe('a pattern flag of discover given twice', () => {
  const read = (argv: string[]) => () => parseArgs(['ask', ...argv]);

  it('is refused with the one pattern that matches either, ready to run', () => {
    expect(read(['discover', '--path', '^packages/cli/', '--path', '^packages/help/', '--text', 'helpFor'])).toThrow(
      "`--path` was given more than once. It takes one regular expression; to match either, give `--path '(?:^packages/cli/)|(?:^packages/help/)'`",
    );
  });

  it('joins a value given with `=` and quotes a quote the value holds', () => {
    expect(read(['discover', "--text=it's", '--text', 'done'])).toThrow(
      "`--text` was given more than once. It takes one regular expression; to match either, give `--text '(?:it'\\''s)|(?:done)'`",
    );
  });

  it('offers no pattern built from a flag that followed it, or from an empty value', () => {
    expect(read(['discover', '--path', 'a', '--path', '--text', 'b'])).toThrow('`--path` needs a value; nothing followed it.');
    expect(read(['discover', '--path=a', '--path='])).toThrow(/^`--path` was given more than once$/u);
  });

  it('names no pattern for a flag that takes none', () => {
    expect(read(['discover', '--from', 'a.ts', '--from', 'b.ts'])).toThrow(/^`--from` was given more than once$/u);
  });
});
