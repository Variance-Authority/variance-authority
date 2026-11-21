// A shop that races its tests on purpose and says nothing about it: the form
// hydrates late, every answer takes a random 50–600 ms, and no `aria-busy`, no
// event and no attribute is written for a test — an app nobody wrote for its
// tests. What it gives is what it gives a person: Continue is disabled until
// the form can answer it.
import { createServer } from 'node:http';

const later = (body) => setTimeout(body, 50 + Math.floor(Math.random() * 550));
let likes = 41;

const shell = (title, body, script) => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<main>${body}</main>
<script type="module">
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
${script}
</script>`;

const checkout = shell(
  'checkout',
  `<form aria-label="Billing details">
  <label for="country">Country</label> <select id="country" name="country"><option value="">—</option><option>NL</option><option>DE</option></select>
  <label>Street <input name="street"></label>
  <ul aria-live="polite"></ul>
  <button disabled>Continue</button>
</form>`,
  `
const form = document.querySelector('main form');
const guest = new URLSearchParams(location.search).get('user') === 'guest';
// Hydration lands late; until then Continue submits the form natively and loses it.
await later(150 + Math.random() * 450);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  form.querySelector('ul').replaceChildren();
  const answer = await (await fetch('/api/billing', {
    method: 'POST',
    body: JSON.stringify({ country: form.country.value, street: form.street.value, guest }),
  })).json();
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
  dialog.innerHTML = '<label>Email <input name="email"></label> <button value="in">Sign in</button>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('click', async (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    await fetch('/api/sign-in', { method: 'POST' });
    dialog.remove();
    payment();
  });
}
function payment() {
  // The billing form fades out over 300 ms: a departed region that still answers.
  form.style.transition = 'opacity 300ms';
  form.style.opacity = '0';
  setTimeout(() => {
    form.remove();
    document.querySelector('main').insertAdjacentHTML('beforeend', '<form aria-label="Payment"><label>Card <input name="card"></label></form>');
  }, 300);
}
form.querySelector('button').disabled = false;
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
  const { likes } = await (await fetch('/api/like', { method: 'POST' })).json();
  count.textContent = likes;
});
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
    case '/checkout':
      return html(checkout);
    case '/product':
      return html(product);
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
    default:
      return response.writeHead(404).end();
  }
}).listen(Number(process.env.VA_PORT));
