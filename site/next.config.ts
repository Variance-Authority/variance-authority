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
  async headers() {
    return [
      { source: "/", headers: RESPONSE_HEADERS },
      { source: "/:path*", headers: RESPONSE_HEADERS },
    ];
  },
};

export default nextConfig;
