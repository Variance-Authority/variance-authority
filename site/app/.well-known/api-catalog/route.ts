import { LLMS_INDEX } from "../../content/llms-index";
import { SITE } from "../../metadata";

export const revalidate = 3600;

/**
 * RFC 9727's catalog. The site serves no API, so it names no description and no
 * status: its one entry says where the site's own documentation starts.
 */
export function GET(): Response {
  const linkset = [
    {
      anchor: `${SITE}/`,
      "service-doc": [{ href: `${SITE}${LLMS_INDEX}` }],
    },
  ];

  return new Response(JSON.stringify({ linkset }), {
    headers: {
      "content-type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    },
  });
}
