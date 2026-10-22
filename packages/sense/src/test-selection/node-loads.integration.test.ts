import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

// A worker whose loads are answered by another process waits on every answer,
// so an answer it cannot read, or a socket that goes away, is said in the
// worker as an error of the load, never left as a wait nobody ends.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const loads = resolve(here, '../../dist/test-selection/node-loads.cjs');
const opened: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((close) => close()));
});

async function answering(answer: (socket: Socket) => void): Promise<{ address: string; file: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'va-'));
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\variance-authority-${randomUUID()}`
    : join(directory, 'answers.sock');
  const server: Server = createServer((socket) => socket.once('data', () => answer(socket)));
  await new Promise<void>((listening) => server.listen(address, listening));
  opened.push(async () => {
    await new Promise((closed) => server.close(closed));
    await rm(directory, { recursive: true, force: true });
  });
  const file = join(directory, 'loaded.cjs');
  await writeFile(file, 'module.exports = 1;\n');
  return { address, file };
}

/** What the worker says when it loads `file`; the bound ends a wait the old asker never would. */
async function load(address: string, file: string): Promise<string> {
  const script = `require(${JSON.stringify(loads)}).answeredBy(${JSON.stringify(address)}, globalThis);` +
    `try { require(${JSON.stringify(file)}); console.log('loaded'); } catch (error) { console.log(error.message); }`;
  const { stdout } = await execute(process.execPath, ['-e', script], { timeout: 10_000 });
  return stdout.trim();
}

describe('a worker whose Node loads another process answers', () => {
  it('fails the load when the answer cannot be read', async () => {
    const { address, file } = await answering((socket) => socket.write('not an answer\n'));

    expect(await load(address, file)).toMatch(/^variance-authority was answered what it cannot read from /);
  }, 20_000);

  it('fails the load when the answering process closes the socket mid-question', async () => {
    const { address, file } = await answering((socket) => socket.destroy());

    expect(await load(address, file)).toMatch(/^variance-authority lost .*: the process that answers closed it$/);
  }, 20_000);
});
