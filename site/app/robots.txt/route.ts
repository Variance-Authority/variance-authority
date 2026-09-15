import { LLMS_LINK } from "../content/llms-index";
import { SITE } from "../metadata";

/**
 * The first file a crawler asks for, so it is where the Markdown index is
 * announced to one that never renders a page: the body carries the sitemap for
 * an indexer, the header carries `/llms.txt` for a reader that wants the source.
 */
export function GET(): Response {
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${SITE}/sitemap.xml`, ""];

  return new Response(body.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      link: LLMS_LINK,
    },
  });
}
