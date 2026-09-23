// A service in its own process, instrumented by its own build, answering the
// run that started it.
//
// Both instruments are here and neither one knows about the other. `collectEvents`
// announces what the code decided; `collectJourneys` records which regions of
// source the same request entered. They are handed the same `Cookie` header and
// they answer the same worker over the same medium, because the header is the
// whole of what either of them is told.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectEvents } from '@variance-authority/event/collect';
import { collectJourneys } from '@variance-authority/sense/journey';
import { testSelectionProbes } from '@variance-authority/sense/journal';

const root = resolve(process.env.VA_ROOT);

// Order matters, and it is the only ordering this file has: the collector
// installs the journey-keyed factory, and an instrumented module reads that
// factory as it initializes. Imported first, the module would register against
// the page-shaped fallback and every crossing after it would go to nobody.
const journeys = collectJourneys();
const events = collectEvents();

/** What a build does, done here so the case owns no bundler. */
async function instrumented() {
  const source = resolve(root, 'src/pricing.mjs');
  const code = await readFile(source, 'utf8');
  const probes = testSelectionProbes({ root, label: process.env.VARIANCE_AUTHORITY_HEAD });
  const transformed = probes.transform.call(
    { getCombinedSourcemap: () => ({ mappings: '' }) },
    code,
    source,
  );

  // The collector import is the page's half, and this realm already has a
  // factory that knows more than it does. Everything else is byte-for-byte what
  // a bundler would have emitted, at the line numbers the inventory recorded.
  const built = resolve(root, 'node_modules/.variance-case/pricing.mjs');
  await mkdir(dirname(built), { recursive: true });
  await writeFile(built, transformed.code.replace(/^import "[^"]+";/, ''), 'utf8');
  return import(pathToFileURL(built).href);
}

const { quote } = await instrumented();

// A handler whose work outlives its response, as a streamed body, a write
// behind or a log flushed after `end()` does. The scope is the request's until
// what the handler returned settles.
const tail = Number(process.env.VA_TAIL_MS ?? 0);
const settled = () => (tail > 0 ? new Promise((done) => setTimeout(done, tail)) : undefined);

const page = `<!doctype html>
<meta charset="utf-8"><title>pricing</title>
<main><p data-testid="quote">…</p></main>
<script type="module">
const locale = new URLSearchParams(location.search).get('locale') ?? 'en';
const response = await fetch('/api/quote?locale=' + locale);
document.querySelector('[data-testid=quote]').textContent = await response.text();
</script>`;

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  // One header, two instruments, and the handler underneath knows about
  // neither. A service that already has a request scope wraps it once here and
  // never again.
  journeys.enter(request.headers.cookie, () =>
    events.enter(request.headers.cookie, () => {
      if (url.pathname === '/api/quote') {
        response
          .writeHead(200, { 'content-type': 'text/plain' })
          .end(quote(url.searchParams.get('locale')));
        return settled();
      }
      response.writeHead(200, { 'content-type': 'text/html' }).end(page);
      return settled();
    }),
  );
}).listen(Number(process.env.VA_PORT));
