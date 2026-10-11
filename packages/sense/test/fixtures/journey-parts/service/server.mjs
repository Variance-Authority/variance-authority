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

const probes = testSelectionProbes({ root: here, label: process.env.VARIANCE_AUTHORITY_HEAD });

/** What a build does, done here so the fixture owns no bundler. */
async function instrumented(name) {
  const source = resolve(here, name);
  // The collector import is the page's half; this realm already has a factory.
  return probes.transform(await readFile(source, 'utf8'), source).code.replace(/^import "[^"]+";/, '');
}

async function imported(name) {
  const built = resolve(process.env.VARIANCE_AUTHORITY_BUILD, `${name.replace(/\.\w+$/, '')}-${process.pid}.mjs`);
  await mkdir(dirname(built), { recursive: true });
  await writeFile(built, await instrumented(name), 'utf8');
  return import(pathToFileURL(built).href);
}

const { quote, refund } = await imported('pricing.mjs');
// Built now and evaluated by the first request that asks for a standing, as a
// loader that requires a module where it is first needed would.
const standingScript = await instrumented('standing.js');
const standing = (tier) => {
  if (globalThis.__standing === undefined) new Function(standingScript)();
  return globalThis.__standing(tier);
};

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  journeys.enter(request.headers.cookie, () => {
    const answer = url.pathname === '/refund'
      ? refund(Number(url.searchParams.get('amount')))
      : url.pathname === '/standing'
        ? standing(url.searchParams.get('tier'))
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
