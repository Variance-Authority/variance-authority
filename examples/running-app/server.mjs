import { createServer } from 'node:http';

// Stands in for your application. Swap `next start`, `rails s`, or anything
// else that answers on a port — nothing below this file knows the difference.

const PLANS = [
  { name: 'Starter', price: '$0', blurb: 'One project, one seat.' },
  { name: 'Team', price: '$29', blurb: 'Unlimited projects, five seats.' },
  { name: 'Company', price: '$99', blurb: 'Everything, plus review gates.' },
];

// How many plans stand side by side once there is room for them. Below the
// breakpoint the cards are always a single column, so this number is the wide
// layout and nothing else.
const WIDE_COLUMNS = 3;

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
  body { margin: 0; font: 16px system-ui, sans-serif; color: #1a1a1a; }
  header { padding: 16px 24px; border-bottom: 1px solid #e2e2e2; font-weight: 600; }
  main { padding: 24px; }
  h1 { margin: 0 0 16px; font-size: 28px; }
  .plans { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 900px) {
    .plans { grid-template-columns: repeat(${WIDE_COLUMNS}, 1fr); }
  }
  .plan { border: 1px solid #d8d8d8; border-radius: 8px; padding: 16px; }
  .plan h2 { margin: 0 0 8px; font-size: 18px; }
  .price { margin: 0 0 8px; font-size: 32px; font-weight: 600; }
  .blurb { margin: 0; color: #555555; }
  p.prose { max-width: 640px; line-height: 1.5; margin: 0 0 12px; }
</style></head><body><header>Northwind</header><main>${body}</main></body></html>`;

const ROUTES = {
  '/': () =>
    page(
      'Plans',
      `<h1>Plans</h1><div class="plans">${PLANS.map(
        (plan) => `<section class="plan"><h2>${plan.name}</h2>
        <p class="price">${plan.price}</p><p class="blurb">${plan.blurb}</p></section>`,
      ).join('')}</div>`,
    ),
  '/seats': () =>
    page(
      'Seats',
      `<h1>What counts as a seat</h1>
      <p class="prose">A seat is one person who can open a project. Bots and
      integrations do not take a seat, and neither does anybody who only reads.</p>
      <p class="prose">Seats are counted on the day we bill, not the day they are added.</p>`,
    ),
};

createServer((request, response) => {
  const route = ROUTES[new URL(request.url, 'http://localhost').pathname];
  if (route === undefined) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(route());
}).listen(5173, () => console.log('listening on http://localhost:5173'));
