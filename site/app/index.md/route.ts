import { MARKDOWN_TYPE } from "../content/llms-index";
import { GET as llms } from "../llms.txt/route";

export const revalidate = 3600;

/**
 * The home has no document of its own, and the index is what it is to a reader
 * that takes Markdown: where everything starts.
 */
export async function GET(): Promise<Response> {
  return new Response(await llms().text(), {
    headers: {
      "content-type": `${MARKDOWN_TYPE}; charset=utf-8`,
      "x-robots-tag": "noindex",
    },
  });
}
