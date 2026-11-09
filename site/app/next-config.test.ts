import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * The framework serves a page's generated metadata after `</head>` to every
 * user agent `htmlLimitedBots` does not match, and a reader that takes the
 * title and canonical from the head then finds neither. The agents here are
 * readers the default list leaves out.
 */
describe("generated metadata", () => {
  it.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
  ])("htmlLimitedBots matches %s", (userAgent) => {
    expect(nextConfig.htmlLimitedBots?.test(userAgent)).toBe(true);
  });
});
