import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperatorError } from './exit.js';
import { parseArgs } from './parse.js';

function refusal(argv: readonly string[]): string {
  try {
    parseArgs(argv);
  } catch (error) {
    if (error instanceof OperatorError) return error.message;
    throw error;
  }
  throw new Error(`expected ${argv.join(' ')} to be refused`);
}

describe('comment and report flags for a reviewer away from a checkout', () => {
  it('takes --to-accept on comment, and drops an empty one', () => {
    expect(parseArgs(['comment', '--to-accept', 'dispatch **variance** with accept'])).toEqual({
      command: 'comment',
      config: resolve('variance.config.json'),
      marker: false,
      toAccept: 'dispatch **variance** with accept',
      reports: [],
    });

    // The action passes the input through whether or not it was set.
    expect(parseArgs(['comment', '--to-accept', ''])).not.toHaveProperty('toAccept');
  });

  it('takes --image-root on comment, and drops an empty one', () => {
    expect(parseArgs(['comment', '--image-root', 'https://example.invalid/raw/abc'])).toMatchObject({
      imageRoot: 'https://example.invalid/raw/abc',
    });
    expect(parseArgs(['comment', '--image-root', ''])).not.toHaveProperty('imageRoot');
  });

  it('refuses --to-accept beside --marker, which renders no body', () => {
    expect(refusal(['comment', '--marker', '--to-accept', 'x'])).toContain(
      'prints the marker and nothing else',
    );
  });

  it('takes --embed-images with the HTML page, and refuses it anywhere else', () => {
    expect(parseArgs(['report', '--format', 'html', '--embed-images'])).toMatchObject({
      command: 'report',
      format: 'html',
      embedImages: true,
    });
    expect(refusal(['report', '--embed-images'])).toContain('add --format html');
  });
});
