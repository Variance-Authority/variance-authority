import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from './args.js';
import { parseAskArgs } from './ask-args.js';
import { flagsFor, synopsisFor } from './usage.js';

describe('source refresh input', () => {
  it('resolves the authoritative changed-file list', () => {
    const flags = readFlags(
      ['search', '--query', 'button', '--changed-file', 'changed.txt'],
      'ask',
      flagsFor('ask'),
      synopsisFor('ask'),
    );

    expect(parseAskArgs(flags, resolve('variance.config.json'))).toMatchObject({
      question: 'search',
      query: 'button',
      changedFile: resolve('changed.txt'),
    });
  });
});
