// A service in its own process, started under its tracer's own `--import`
// setup. It never reads a journey: the head asks the tracer which trace is
// running, and the tracer continued whatever trace the request came in with.
// `checkout` answers by calling `pricing` over plain `fetch`.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectJourneys } from '@variance-authority/sense/journey';
import { testSelectionProbes } from '@variance-authority/sense/journal';

const here = dirname(fileURLToPath(import.meta.url));
const service = process.env.VARIANCE_AUTHORITY_HEAD;
const next = process.env.NEXT_SERVICE;
const { trace } = await import(`../${process.env.TRACER}/trace.mjs`);

// Installed before the instrumented module initializes, so the module's probes
// land in the journey-keyed factory. Writes to VARIANCE_AUTHORITY_PARTS.
const journeys = collectJourneys({ trace });

/** What a build does, done here so the fixture owns no bundler. */
async function instrumented() {
  const source = resolve(here, `${service}.mjs`);
  const code = await readFile(source, 'utf8');
  const probes = testSelectionProbes({ root: here, label: service });
  const transformed = probes.transform(code, source);
  const built = resolve(process.env.VARIANCE_AUTHORITY_BUILD, `${service}-${process.pid}.mjs`);
  await mkdir(dirname(built), { recursive: true });
  // The collector import is the page's half; this realm already has a factory.
  await writeFile(built, transformed.code.replace(/^import "[^"]+";/, ''), 'utf8');
  return import(pathToFileURL(built).href);
}

const module = await instrumented();

async function answer(url) {
  if (service === 'pricing') {
    return url.pathname === '/refund'
      ? module.refund(Number(url.searchParams.get('amount')))
      : module.quote(url.searchParams.get('currency'));
  }
  const local = url.pathname === '/refund'
    ? module.returned(Number(url.searchParams.get('amount')))
    : module.basket(url.searchParams.get('currency'));
  const priced = await (await fetch(`${next}${url.pathname}${url.search}`)).text();
  return `${local}: ${priced}`;
}

const server = createServer((request, response) => {
  void answer(new URL(request.url, 'http://localhost')).then((text) => {
    response.writeHead(200, { 'content-type': 'text/plain' }).end(text);
  });
});

process.on('SIGTERM', () => {
  server.close();
  void journeys.close().then(() => process.exit(0));
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${server.address().port}\n`);
});
