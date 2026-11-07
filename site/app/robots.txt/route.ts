import { SITE } from "../metadata";

export const revalidate = 3600;

/**
 * The first file a crawler asks for. The body carries the sitemap for an
 * indexer and says the site may be trained on, indexed and read into an answer,
 * since a public documentation site is written to be found; the `Link:` header
 * naming `/llms.txt` comes from the site's response headers, which every
 * response carries.
 */
export function GET(): Response {
  const body = [
    "User-agent: *",
    "Content-Signal: ai-train=yes, search=yes, ai-input=yes",
    "Allow: /",
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ];

  return new Response(body.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
