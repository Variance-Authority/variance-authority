import { describe, expect, it } from 'vitest';
import { readRequest } from './bin.js';
import type { Command } from './provision.js';

const gh = (stdout: string, code = 0) => async (): Promise<Command> => ({ code, stdout, stderr: '' });

describe('readRequest', () => {
  it('takes the repository gh sees when none is named', async () => {
    expect(await readRequest(['--config', 'deploy/wrangler.jsonc'], gh('acme/shop\n'))).toEqual({
      config: 'deploy/wrangler.jsonc',
      repository: 'acme/shop',
      rotate: false,
    });
  });

  it('keeps a named repository and reviewer', async () => {
    const request = await readRequest(['--repository', 'a/b', '--reviewer', 'r@x.dev', '--rotate'], gh('', 1));
    expect(request).toEqual({ config: 'wrangler.jsonc', repository: 'a/b', reviewer: 'r@x.dev', rotate: true });
  });

  it('refuses when no repository can be named', async () => {
    await expect(readRequest([], gh('', 1))).rejects.toThrow(/--repository/);
  });

  it('answers --help without asking gh', async () => {
    expect(await readRequest(['--help'], gh('', 1))).toBe('help');
  });

  it('refuses an argument it does not know', async () => {
    await expect(readRequest(['--token', 'x'], gh('a/b'))).rejects.toThrow(/token/);
  });
});
