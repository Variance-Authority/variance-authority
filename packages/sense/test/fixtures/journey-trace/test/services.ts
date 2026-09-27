import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const tracer = process.env['TRACER']!;

async function start(name: string, next?: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(
    process.execPath,
    ['--import', resolve(__dirname, `../${tracer}/instrument.mjs`), resolve(__dirname, '../service/server.mjs')],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, VARIANCE_AUTHORITY_HEAD: name, ...(next === undefined ? {} : { NEXT_SERVICE: next }) },
    },
  );
  const port = await new Promise<number>((done, fail) => {
    child.once('exit', (code) => fail(new Error(`${name} exited ${code}`)));
    child.stdout!.once('data', (chunk: Buffer) => done(Number(String(chunk).trim())));
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

/**
 * Checkout in front of pricing, started for one test file and stopped after
 * it. A call is a plain `fetch`: whatever crosses to checkout, and from there
 * to pricing, is the tracer's doing.
 */
export function services(): { call: (path: string) => Promise<string> } {
  const children: ChildProcess[] = [];
  let checkout = '';
  beforeAll(async () => {
    const pricing = await start('pricing');
    const front = await start('checkout', pricing.url);
    children.push(pricing.child, front.child);
    checkout = front.url;
  });
  afterAll(async () => {
    await Promise.all(children.map((child) => {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      return exited;
    }));
  });
  return { call: async (path) => (await fetch(`${checkout}${path}`)).text() };
}
