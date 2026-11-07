import type { NextConfig } from "next";
import { LLMS_LINK } from "./app/content/llms-index";

/**
 * Headers every response carries.
 *
 * `Link` names the Markdown index, so a reader that fetches a URL without
 * rendering it — a page, `robots.txt`, a document's Markdown — is told where
 * the source starts without having to parse anything first.
 *
 * The rest close the defaults a static documentation site has no use for: the
 * site serves no credentials and embeds nothing of its own, so a sniffed
 * content type, a framing parent and a full referrer are all avenues it gains
 * nothing by leaving open.
 */
const RESPONSE_HEADERS = [
  { key: "Link", value: LLMS_LINK },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  /**
   * Every agent that sends a `User-Agent` gets a page's metadata in the head; the
   * framework streams to a request with none before it reads this. A generated
   * title otherwise streams after `</head>` to whoever this does not match, which
   * protects a first byte this site has nothing to delay: the metadata is read
   * from bundled Markdown, and the CDN serves the page.
   */
  htmlLimitedBots: /.*/,
  async headers() {
    return [
      { source: "/", headers: RESPONSE_HEADERS },
      { source: "/:path*", headers: RESPONSE_HEADERS },
      {
        source: "/.well-known/api-catalog",
        headers: [{ key: "Link", value: `${LLMS_LINK}, </.well-known/api-catalog>; rel="api-catalog"` }],
      },
    ];
  },
};

export default nextConfig;
