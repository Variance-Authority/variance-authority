/**
 * Receives parts over HTTP from a service that has no host filesystem, such as
 * a Worker, and appends them where a service with one would have written.
 *
 * Each POST to `/<name>.vac` appends its body to `<directory>/<name>.vac`. The
 * body is already length-prefixed frames, so the file reads exactly as the
 * directory sink would have left it, and the fold needs no second format.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export interface PartsReceiver {
  /** The address a head writes to: pass it as the parts target. */
  readonly url: string;
  close(): Promise<void>;
}

export async function receiveParts(
  directory: string,
  options: { port?: number; host?: string } = {},
): Promise<PartsReceiver> {
  mkdirSync(directory, { recursive: true });
  const server: Server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '').replace(/^\/+/, '').split('?')[0] ?? '');
    if (request.method !== 'POST' || !/^[\w.-]+\.vac$/.test(name)) {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      appendFileSync(join(directory, name), Buffer.concat(chunks));
      response.writeHead(204).end();
    });
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
