import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './bin.fixture.js';

/**
 * `--by` from the command line to the history row.
 *
 * A name dropped on the way is an accept that still prints, so the only place
 * that shows it is what the history service receives. Driven through `main` for
 * that reason, against a local service.
 */

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
const IDENTITY = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
});

/** A history service that keeps what it was sent. */
async function historyService(): Promise<{ endpoint: string; received: string[] }> {
  const received: string[] = [];
  const server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      received.push(text);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  return { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

async function repoWithAChange(endpoint: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-accept-by-'));
  await mkdir(join(root, '.variance', 'images'), { recursive: true });
  await writeFile(join(root, '.variance', 'images', 'a.after.png'), Buffer.from(PIXEL, 'base64'));
  await writeFile(
    join(root, '.variance', 'images', 'a.after.json'),
    JSON.stringify({ documentDigest: 'sha256-candidate', identity: IDENTITY, width: 1, height: 1, missingFonts: [] }),
  );
  await writeFile(
    join(root, '.variance', 'report.json'),
    JSON.stringify({
      runVersion: 1,
      at: '2026-08-01T00:00:00.000Z',
      identity: IDENTITY,
      retention: 'durable',
      run: { id: 'run-1', at: '2026-08-01T00:00:00.000Z' },
      observations: [
        {
          subject: 'fixture:a',
          verdict: 'changed',
          because: '86 pixel(s) differ',
          changedPixels: 86,
          regions: [],
          images: { after: 'images/a.after.png' },
        },
      ],
    }),
  );
  await writeFile(
    join(root, 'variance.config.json'),
    JSON.stringify({
      project: 'named',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'durable',
      baselines: { kind: 'directory', root: 'baselines' },
      history: { endpoint, token: 't' },
      subjects: { kind: 'list', ids: ['fixture:a'], collector: './collector.mjs' },
      fonts: [],
      report: '.variance/report.json',
    }),
  );
  return root;
}

describe('accept --by', () => {
  it('reaches the history row', async () => {
    const { endpoint, received } = await historyService();
    const root = await repoWithAChange(endpoint);
    let said = '';

    const code = await main(['accept', '--config', join(root, 'variance.config.json'), '--all', '--by', 'ana'], {
      out: (text) => {
        said += text;
      },
      err: (text) => {
        said += text;
      },
    });

    expect(said).not.toContain('not recorded');
    expect(code).toBe(0);
    expect(received.join('')).toContain('"by":"ana"');
  });
});
