import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * A static Storybook build on a free local port, for the isolated case and its
 * bench: the preview fetches, so `file://` is out. Answers `baseUrl` and
 * `close`.
 */
export async function serveStatic(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const resolved = join(root, normalize(path === '/' ? '/index.html' : path));
    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' });
    response.end(readFileSync(resolved));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
