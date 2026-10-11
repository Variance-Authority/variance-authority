import { describe, expect, it } from 'vitest';
import { wordsOf } from './words.js';

/**
 * A question handed to `intersection` is one argument on the command line and
 * several inside it, split the way a POSIX shell splits words, so it can be
 * pasted from where it was asked alone.
 */
describe('a question typed as one argument is split as a shell splits it', () => {
  it('splits on runs of whitespace', () => {
    expect(wordsOf('  symbol --name\tselectBalance \n')).toEqual(['symbol', '--name', 'selectBalance']);
  });

  it('keeps everything in single quotes as written, a backslash included', () => {
    expect(wordsOf("discover --declares '^(Theme|User)Context$' --text 'a\\b'")).toEqual([
      'discover',
      '--declares',
      '^(Theme|User)Context$',
      '--text',
      'a\\b',
    ]);
  });

  it('takes a backslash in double quotes as escaping a quote or a backslash, and nothing else', () => {
    expect(wordsOf('grep --query "say \\"hi\\" \\\\ \\d"')).toEqual(['grep', '--query', 'say "hi" \\ \\d']);
  });

  it('takes a backslash outside quotes as making the next character literal', () => {
    expect(wordsOf('search --query rule\\ executor')).toEqual(['search', '--query', 'rule executor']);
  });

  it('joins quoted and bare parts written without a space into one word', () => {
    expect(wordsOf(`--path ^src/'my dir'/"x"`)).toEqual(['--path', '^src/my dir/x']);
  });

  it('keeps an empty quoted word', () => {
    expect(wordsOf("grep --query ''")).toEqual(['grep', '--query', '']);
  });

  it('refuses a quote left open', () => {
    expect(() => wordsOf("discover --declares '^Theme")).toThrow("`discover --declares '^Theme` opens a ' quote and never closes it");
  });
});
