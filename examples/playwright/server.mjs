import { createServer } from 'node:http';

// Stands in for your application. The point of this example is the states it
// can get into, not how it is built.

// The error banner. Its padding is the one thing this example asks you to change.
const BANNER_PADDING = '10px 12px';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Join</title><style>
  body { margin: 0; font: 16px system-ui, sans-serif; color: #1a1a1a; }
  main { padding: 24px; max-width: 420px; }
  h1 { margin: 0 0 16px; font-size: 24px; }
  label { display: block; margin: 0 0 6px; font-size: 14px; color: #555555; }
  input { width: 100%; box-sizing: border-box; padding: 8px; font: inherit;
    border: 1px solid #b4b4b4; border-radius: 6px; }
  button { margin-top: 12px; padding: 8px 16px; font: inherit; border-radius: 6px;
    border: 1px solid #1f47c4; background: #2b5cff; color: #ffffff; }
  #error { display: none; margin: 0 0 12px; padding: ${BANNER_PADDING};
    border: 1px solid #d08b8b; border-radius: 6px; background: #fdeaea; color: #8a2020; }
  #error.shown { display: block; }
</style></head><body><main>
  <h1>Join the beta</h1>
  <p id="error" role="alert">Enter the email you want the invite sent to.</p>
  <form id="join">
    <label for="email">Work email</label>
    <input id="email" name="email" type="text" autocomplete="off">
    <button type="submit">Request an invite</button>
  </form>
</main><script>
  document.getElementById('join').addEventListener('submit', (event) => {
    event.preventDefault();
    const empty = document.getElementById('email').value.trim() === '';
    document.getElementById('error').classList.toggle('shown', empty);
  });
</script></body></html>`;

createServer((request, response) => {
  response
    .writeHead(request.url === '/' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    .end(request.url === '/' ? PAGE : 'not found');
}).listen(5174, () => console.log('listening on http://localhost:5174'));
