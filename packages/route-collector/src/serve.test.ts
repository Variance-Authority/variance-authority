import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic, type StaticServer } from './serve.js';

/**
 * What the static server answers, with no browser in the way.
 *
 * The cases here are all shapes a real build directory has, and each of them
 * used to be a way for one request to end the whole run: the read is
 * synchronous inside the request handler, so a throw there is past every `await`
 * the run could have caught it at.
 */

let root = '';
let server: StaticServer | undefined;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'variance-serve-'));
  mkdirSync(join(root, 'about'), { recursive: true });
  mkdirSync(join(root, 'img'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Home</title>');
  writeFileSync(join(root, 'about', 'index.html'), '<!doctype html><title>About</title>');

  server = await serveStatic(root);
});

afterAll(async () => {
  await server?.close();
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

describe('serveStatic', () => {
  it('answers a directory with its index, which is the URL the page is planned at', async () => {
    const response = await fetch(`${server!.baseUrl}/about/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('About');
  });

  it('answers a directory with no index as missing, and stays up', async () => {
    const response = await fetch(`${server!.baseUrl}/img/`);

    expect(response.status).toBe(404);
    // The assertion that matters is the next request being answered at all: a
    // read that threw here took the process with it.
    expect((await fetch(`${server!.baseUrl}/`)).status).toBe(200);
  });

  it('refuses a path that escapes the root before asking what is there', async () => {
    const response = await fetch(`${server!.baseUrl}/../../etc/passwd`);

    expect(response.status).toBe(404);
  });
});
