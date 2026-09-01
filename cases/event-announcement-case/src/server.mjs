// The application and the service behind it, both announcing.
//
// The decision the spec waits for is made after a wait that varies by an order
// of magnitude, on purpose: that is the wait a screen-only assertion is racing,
// and nothing in the spec is allowed to know how long it is.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectEvents } from '@variance-authority/event/collect';
import { journeyOf } from '@variance-authority/sense/journey';

const events = collectEvents();
// The page is served the package's own built module, unbundled. What the browser
// runs is the shipped `vae`, not a copy of it written to make this pass.
const announcing = readFileSync(
  fileURLToPath(import.meta.resolve('@variance-authority/event')),
  'utf8',
);

const page = `<!doctype html>
<meta charset="utf-8"><title>checkout</title>
<main><h1>Cart</h1></main>
<script type="module">
import { vae, vaStart, vaEnd } from '/event.js';
const wanted = new URLSearchParams(location.search).get('show') === 'yes';
vaStart('checkout', 'upsell-modal', 'deciding');
const response = await fetch('/api/decide?show=' + (wanted ? 'yes' : 'no'));
const { show } = await response.json();
vae('checkout', 'upsell-modal', 'decided');
vaEnd('checkout', 'upsell-modal', 'deciding');
if (show) {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.textContent = 'One more thing';
  document.body.append(dialog);
}
</script>`;

function decide(request, response, wanted) {
  vaStart('pricing', 'upsell', 'quoting');
  setTimeout(
    () => {
      vae('pricing', 'upsell', 'quoted');
      vaEnd('pricing', 'upsell', 'quoting');
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ show: wanted }));
    },
    60 + Math.floor(Math.random() * 500),
  );
}

const { vae, vaStart, vaEnd } = await import('@variance-authority/event');

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/event.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(announcing);
    return;
  }
  if (url.pathname === '/api/decide') {
    events.enter(journeyOf(request.headers.cookie), () =>
      decide(request, response, url.searchParams.get('show') === 'yes'),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' }).end(page);
}).listen(Number(process.env.VA_PORT));
