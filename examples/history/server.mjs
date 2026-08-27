import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

// Two files off disk, read per request so an edit shows up on the next run
// without a restart. Nothing here is the example; the example is what the
// history service says about `--card-padding` after four of them.
const TYPES = { '.html': 'text/html', '.css': 'text/css' };

createServer((request, response) => {
  const path = request.url === '/' ? '/index.html' : (request.url ?? '/');
  readFile(new URL(`./src${path}`, import.meta.url)).then(
    (body) => {
      response.writeHead(200, {
        'content-type': `${TYPES[path.slice(path.lastIndexOf('.'))] ?? 'text/plain'}; charset=utf-8`,
      });
      response.end(body);
    },
    () => response.writeHead(404).end(),
  );
}).listen(5176, () => console.log('billing page on http://localhost:5176'));
