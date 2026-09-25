// A service in its own process, built by its own transform. It knows nothing
// about Jest: it reads the journey off the cookie the caller put on the
// request, and writes what each journey ran into its parts directory.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectJourneys } from '@variance-authority/sense/journey';
import { testSelectionProbes } from '@variance-authority/sense/journal';

const here = dirname(fileURLToPath(import.meta.url));

// Installed before the instrumented module initializes, so the module's probes
// land in the journey-keyed factory.
const journeys = collectJourneys();

/** What a build does, done here so the fixture owns no bundler. */
async function instrumented() {
  const source = resolve(here, 'pricing.mjs');
  const code = await readFile(source, 'utf8');
  const probes = testSelectionProbes({ root: here, label: process.env.VARIANCE_AUTHORITY_HEAD });
  const transformed = probes.transform.call({ getCombinedSourcemap: () => ({ mappings: '' }) }, code, source);
  const built = resolve(process.env.VARIANCE_AUTHORITY_BUILD, `pricing-${process.pid}.mjs`);
  await mkdir(dirname(built), { recursive: true });
  // The collector import is the page's half; this realm already has a factory.
  await writeFile(built, transformed.code.replace(/^import "[^"]+";/, ''), 'utf8');
  return import(pathToFileURL(built).href);
}

const { quote, refund } = await instrumented();

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  journeys.enter(request.headers.cookie, () => {
    const answer = url.pathname === '/refund'
      ? refund(Number(url.searchParams.get('amount')))
      : quote(url.searchParams.get('currency'));
    response.writeHead(200, { 'content-type': 'text/plain' }).end(answer);
  });
});

process.on('SIGTERM', () => {
  server.close();
  void journeys.close().then(() => process.exit(0));
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${server.address().port}\n`);
});
