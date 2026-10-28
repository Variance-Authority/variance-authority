// Renders two React Server Components requests that overlap, each streaming
// two Suspense boundaries, and prints what each request's payload holds and
// what a read outside any request answers. Run under `--conditions react-server`.
import { registerHooks } from 'node:module';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { isolate } from '../../../dist/transform.js';

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/visits.mjs')) return loaded;
    return { ...loaded, source: isolate(String(loaded.source), fileURLToPath(url)).code };
  },
});

const { createElement, Suspense } = await import('react');
const { renderToPipeableStream } = await import('react-server-dom-parcel/server');
const { requestSessions } = await import('@variance-authority/isolator/react');
const { visit } = await import('./visits.mjs');

requestSessions();

const gate = () => {
  let open;
  const opened = new Promise((resolve) => (open = resolve));
  return { opened, open };
};

async function Section({ name, until }) {
  await until.opened;
  return `${name}:${visit()}`;
}

function Page({ first, second }) {
  return createElement(
    'main',
    null,
    `page:${visit()}`,
    createElement(Suspense, { fallback: 'waiting' }, createElement(Section, { name: 'first', until: first })),
    createElement(Suspense, { fallback: 'waiting' }, createElement(Section, { name: 'second', until: second })),
  );
}

const request = () => {
  const gates = { first: gate(), second: gate() };
  let payload = '';
  const done = new Promise((resolve, reject) => {
    const sink = new Writable({
      write(chunk, _encoding, next) {
        payload += chunk;
        next();
      },
    });
    sink.on('finish', () => resolve(payload));
    renderToPipeableStream(createElement(Page, gates), { onError: reject }).pipe(sink);
  });
  return { gates, done };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

const one = request();
const two = request();
await settle();
// Interleaved, so a shared counter would hand each request the other's visits.
for (const open of [one.gates.first, two.gates.first, two.gates.second, one.gates.second]) {
  open.open();
  await settle();
}

const pick = (payload) => payload.match(/(page|first|second):\d+/g);
console.log(JSON.stringify({ one: pick(await one.done), two: pick(await two.done), outside: visit() }));
