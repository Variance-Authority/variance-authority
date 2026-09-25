import { journeyCookie } from '@variance-authority/sense/case-journey';

/**
 * A call to the shop, which runs in another process the harness started. The
 * case's journey cookie is the whole of what crosses the fence, and the case
 * puts it on the request itself.
 */
export async function shop(path: string): Promise<unknown> {
  const response = await fetch(`http://localhost:${process.env['PORT'] ?? 8123}${path}`, {
    headers: { cookie: journeyCookie() },
  });
  return response.json();
}
