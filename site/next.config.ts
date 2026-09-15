import type { NextConfig } from "next";
import { LLMS_LINK } from "./app/content/llms-index";

const nextConfig: NextConfig = {
  /**
   * Every response names the Markdown index, so a reader that fetches a URL
   * without rendering it — a page, `robots.txt`, a document's Markdown — is
   * told where the source starts without having to parse anything first.
   */
  async headers() {
    const link = [{ key: "Link", value: LLMS_LINK }];
    return [
      { source: "/", headers: link },
      { source: "/:path*", headers: link },
    ];
  },
};

export default nextConfig;
