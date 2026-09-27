import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { journeyCookie } from '@variance-authority/sense/case-journey';

/** The service, started for one test file and stopped after it. */
export function service(): { call: (path: string, carry?: boolean) => Promise<string> } {
  let child: ChildProcess | undefined;
  let port = 0;
  beforeAll(async () => {
    child = spawn(process.execPath, [resolve(__dirname, '../service/server.mjs')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    port = await new Promise<number>((done, fail) => {
      child!.once('exit', (code) => fail(new Error(`service exited ${code}`)));
      child!.stdout!.once('data', (chunk: Buffer) => done(Number(String(chunk).trim())));
    });
  });
  afterAll(async () => {
    const exited = new Promise((done) => child!.once('exit', done));
    child!.kill('SIGTERM');
    await exited;
  });
  return {
    // The cookie is the whole of what crosses the fence, and the test puts it
    // on the request itself.
    call: async (path, carry = true) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: carry ? { cookie: journeyCookie() } : {},
      });
      return response.text();
    },
  };
}
