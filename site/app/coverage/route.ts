export const revalidate = 3600;

/**
 * Where the review action keeps `main`'s coverage page: the one file of a
 * commit with no parent, replaced on each push. raw.githubusercontent.com
 * answers it as `text/plain` with `nosniff`, so a browser would show its
 * source; this route answers it as the page.
 */
const KEPT =
  "https://raw.githubusercontent.com/Variance-Authority/variance-authority/refs/coverage/main/coverage.html";

/**
 * The page draws itself from its own inline style and script and loads
 * nothing, so the policy allows those two and refuses every request a changed
 * page could make. The sandbox gives it an origin of its own, so its script
 * reaches nothing the site's origin holds.
 */
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

/**
 * `main`'s coverage page, read again on the hour. A ref that cannot be read
 * answers 503 with `no-store`, telling every cache not to hold it.
 */
export async function GET(): Promise<Response> {
  const read = await fetch(KEPT)
    .then(async (response) => (response.ok ? response.text() : { failed: String(response.status) }))
    .catch((error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) }));
  if (typeof read !== "string") {
    return new Response(
      `The coverage page could not be read from refs/coverage/main (${read.failed}). The next push to main keeps a new one.\n`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
    );
  }
  return new Response(read, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": POLICY },
  });
}
