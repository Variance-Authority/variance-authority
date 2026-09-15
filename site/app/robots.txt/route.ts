import { SITE } from "../metadata";

/**
 * The first file a crawler asks for. The body carries the sitemap for an
 * indexer; the `Link:` header naming `/llms.txt` comes from the site's response
 * headers, which every response carries.
 */
export function GET(): Response {
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${SITE}/sitemap.xml`, ""];

  return new Response(body.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
