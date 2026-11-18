// A shop that races its tests on purpose: the form hydrates late, every answer
// takes a random 50–600 ms, and the page shouts what it is doing — `aria-busy`
// on what is working, and `vaStart`/`vaEnd` around it. With `VA_SILENT` it is
// the same shop saying nothing: no `aria-busy`, no event, as an app nobody
// wrote for its tests. What it gives instead is what it gives a person: Continue
// is disabled until the form can answer it.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const announcing = readFileSync(fileURLToPath(import.meta.resolve('@variance-authority/event')), 'utf8');
const later = (body) => setTimeout(body, 50 + Math.floor(Math.random() * 550));
const SILENT = process.env.VA_SILENT === '1';
const BUSY = SILENT ? '' : ' aria-busy="true"';
let likes = 41;

const shell = (title, body, script) => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<header role="banner"><form role="search" action="/results"><input type="search" name="q" aria-label="Search"></form></header>
<main>${body}</main>
<script type="module">
${SILENT ? 'const vae = () => {}, vaStart = vae, vaEnd = vae;' : "import { vae, vaStart, vaEnd } from '/event.js';"}
const busy = (element, on) => ${SILENT ? 'undefined' : "element.setAttribute('aria-busy', String(on))"};
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
${script}
</script>`;

const checkout = shell(
  'checkout',
  `<form aria-label="Billing details"${BUSY}>
  <label for="country">Country</label> <select id="country" name="country"><option value="">—</option><option>NL</option><option>DE</option></select>
  <label>Street <input name="street"></label>
  <ul aria-live="polite"></ul>
  <button${SILENT ? ' disabled' : ''}>Continue</button>
</form>`,
  `
const form = document.querySelector('main form');
const guest = new URLSearchParams(location.search).get('user') === 'guest';
// Hydration lands late; until then Continue submits the form natively and loses it.
vaStart('checkout', 'billing', 'hydrating');
await later(150 + Math.random() * 450);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(form, true);
  form.querySelector('ul').replaceChildren();
  vaStart('checkout', 'billing', 'submitting');
  const answer = await (await fetch('/api/billing', {
    method: 'POST',
    body: JSON.stringify({ country: form.country.value, street: form.street.value, guest }),
  })).json();
  vae('checkout', 'billing', answer.next);
  vaEnd('checkout', 'billing', 'submitting');
  busy(form, false);
  if (answer.next === 'invalid') {
    form.querySelector('ul').replaceChildren(...answer.errors.map((text) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'alert');
      item.textContent = text;
      return item;
    }));
  } else if (answer.next === 'sign-in') {
    signIn();
  } else {
    payment();
  }
});
function signIn() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Sign in');
  dialog.innerHTML = '<label>Email <input name="email"></label> <button value="in">Sign in</button> <button value="cancel">Cancel</button> <button value="help">Help</button>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('click', async (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    // A stuck query breaks Cancel, so the dialog stays open over the form.
    if (event.target.value === 'cancel') return location.search.includes('stuck') ? undefined : dialog.remove();
    // Help opens over the sign-in, which opened over the form: a cover on a cover.
    if (event.target.value === 'help') return help();
    busy(dialog, true);
    await fetch('/api/sign-in', { method: 'POST' });
    dialog.remove();
    payment();
  });
}
function help() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Help');
  dialog.innerHTML = '<p>Sign in with the email you ordered with.</p> <button>Close</button>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('button').addEventListener('click', () => dialog.remove());
}
function payment() {
  // The billing form fades out over 300 ms: a departed region that still answers,
  // so it says it is busy until it is gone.
  busy(form, true);
  form.style.transition = 'opacity 300ms';
  form.style.opacity = '0';
  setTimeout(() => {
    form.remove();
    document.querySelector('main').insertAdjacentHTML('beforeend', '<form aria-label="Payment"><label>Card <input name="card"></label></form>');
  }, 300);
}
form.querySelector('button').disabled = false;
busy(form, false);
vaEnd('checkout', 'billing', 'hydrating');
`,
);

const product = shell(
  'product',
  `<article aria-label="Product"><h1>Socks</h1>
  <button>Like</button> <span data-testid="likes">…</span></article>`,
  `
const button = document.querySelector('article button');
const count = document.querySelector('[data-testid=likes]');
count.textContent = (await (await fetch('/api/likes')).json()).likes;
button.addEventListener('click', async () => {
  busy(button, true);
  vaStart('product', 'like', 'liking');
  const { likes } = await (await fetch('/api/like', { method: 'POST' })).json();
  count.textContent = likes;
  busy(button, false);
  vaEnd('product', 'like', 'liking');
});
`,
);

const results = shell(
  'results',
  `<section aria-label="Results"${BUSY}><ul></ul></section>`,
  `
const section = document.querySelector('section');
const q = new URLSearchParams(location.search).get('q');
const { items } = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
section.querySelector('ul').replaceChildren(...items.map((text) => {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}));
busy(section, false);
`,
);

function json(response, body) {
  later(() => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body)));
}

async function read(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body === '' ? {} : JSON.parse(body);
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const html = (page) => response.writeHead(200, { 'content-type': 'text/html' }).end(page);
  switch (url.pathname) {
    case '/event.js':
      return response.writeHead(200, { 'content-type': 'text/javascript' }).end(announcing);
    case '/checkout':
      return html(checkout);
    case '/product':
      return html(product);
    case '/results':
      return html(results);
    case '/api/billing': {
      const { country, street, guest } = await read(request);
      const errors = [country ? '' : 'Choose a country', street ? '' : 'Enter a street'].filter(Boolean);
      return json(response, errors.length > 0 ? { next: 'invalid', errors } : { next: guest ? 'sign-in' : 'payment' });
    }
    case '/api/sign-in':
      return json(response, {});
    case '/api/likes':
      return json(response, { likes });
    case '/api/like':
      likes += 1;
      return json(response, { likes });
    case '/api/search':
      return json(response, { items: [`${url.searchParams.get('q')} — wool`, `${url.searchParams.get('q')} — cotton`] });
    default:
      return response.writeHead(404).end();
  }
}).listen(Number(process.env.VA_PORT));
