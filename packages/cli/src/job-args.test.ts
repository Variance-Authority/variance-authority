import { describe, expect, it } from 'vitest';
import { parseArgs } from './parse.js';

describe('what job is asked for', () => {
  it('takes everything after the separator as the command, its flags included', () => {
    expect(parseArgs(['job', '--suite', 'site-job', '--', 'yarn', 'install', '--immutable'])).toEqual({
      command: 'job',
      suite: 'site-job',
      run: ['yarn', 'install', '--immutable'],
    });
  });

  it('refuses a job with no suite to record it under', () => {
    expect(() => parseArgs(['job', '--', 'yarn', 'build'])).toThrow(/--suite/);
  });

  it('refuses a job with no command', () => {
    expect(() => parseArgs(['job', '--suite', 'site-job'])).toThrow(/a command to run/);
  });
});
