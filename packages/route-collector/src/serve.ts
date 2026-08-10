import { createServer, type Server } from 'node:http';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { extname, join, normalize } from 'node:path';

/**
 * A static server for a built site, because `file://` will not do.
 *
 * The no-code on-ramp Percy calls a static directory: point at the output of a
 * build and get a subject per page, with nothing to write. `file://` cannot serve
 * it — an application's own fetches, module imports and absolute asset paths are
 * all blocked by its origin rules, and a page that half-loaded would be captured
 * as a page rather than as a failure.
 *
 * A site that is *already served* needs none of this: give `routes` or a
 * `sitemap` an address and nothing here has an opinion about how it is hosted.
 * That is the arrangement to prefer, because a run against a real server is a run
 * against the thing that will be deployed.
 *
 * **The same seventy lines are in `@variance-authority/storybook-collector`, and
 * that is deliberate** — the same trade `source.ts` documents in both. What would
 * be shared is a file server; what it would cost is a surface package importing
 * another surface package, so an adopter's dependency tree carries a collector
 * they did not ask for (ADR-0024).
 */

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

/**
 * Every `.html` file under a root, relative to it, in no particular order.
 *
 * Only `.html`, because a page is what a browser can be pointed at. Everything
 * else in a build directory — the scripts, the styles, the images — is *part of*
 * a page rather than one, and a run that treated `main.js` as a subject would
 * report a document nobody visits.
 */
export function pagesIn(root: string): readonly string[] {
  const found: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    let entries: readonly Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.name.endsWith('.html')) found.push(relative);
    }
  };

  walk(root, '');
  return found;
}

export interface StaticServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function serveStatic(root: string): Promise<StaticServer> {
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const resolved = join(root, normalize(path === '/' ? '/index.html' : path));

    // Containment before existence: a request that escapes the root must be
    // refused rather than answered, and answering it 404 when it happens to miss
    // would make the refusal depend on what is on disk.
    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(resolved));
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      // `close` alone waits for open connections to drain, and a browser that has
      // just been killed does not always get to send its FIN — so the callback
      // never fires and a run that produced a correct report hangs on exit. The
      // sockets are ours and the browser is gone; ending them races nothing.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
