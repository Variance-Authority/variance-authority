import { describe, expect, it } from 'vitest';
import { readRequest, serving } from './bin.js';
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

  it('keeps a named repository', async () => {
    const request = await readRequest(['--repository', 'a/b', '--skip-deploy', '--rotate'], gh('', 1));
    expect(request).toEqual({ config: 'wrangler.jsonc', repository: 'a/b', skipDeploy: true, rotate: true });
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

describe('serving', () => {
  const answering = (body: string, status: number, type: string) =>
    (async () => new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

  it.each([
    ['the Worker', answering('{}', 200, 'application/json'), true],
    ['a placeholder', answering('Hello', 200, 'text/plain'), false],
    ['a Worker that cannot start', answering('{"error":"x"}', 500, 'application/json'), false],
    ['nothing', (async () => Promise.reject(new Error('refused'))) as unknown as typeof fetch, false],
  ])('reads %s', async (_, send, expected) => {
    expect(await serving('https://tribunal.example/auth/me', send)).toBe(expected);
  });
});
