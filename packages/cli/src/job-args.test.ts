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

  it('takes the exit that still means the command ran whole', () => {
    expect(parseArgs(['job', '--suite', 'site-job', '--complete-on', '1', '--', 'yarn', 'build'])).toMatchObject({ completeOn: 1 });
  });

  it('refuses a complete exit that is no exit', () => {
    expect(() => parseArgs(['job', '--suite', 'site-job', '--complete-on', 'one', '--', 'yarn', 'build'])).toThrow(/--complete-on/);
  });

  it('refuses a job with no suite to record it under', () => {
    expect(() => parseArgs(['job', '--', 'yarn', 'build'])).toThrow(/--suite/);
  });

  it('refuses a job with no command', () => {
    expect(() => parseArgs(['job', '--suite', 'site-job'])).toThrow(/a command to run/);
  });
});
