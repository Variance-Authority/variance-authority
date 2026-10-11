import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from './args.js';
import { parseAskArgs } from './ask-args.js';
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
