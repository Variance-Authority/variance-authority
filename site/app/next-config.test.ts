import { describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import { generateMetadata } from "./(docs)/docs/[slug]/page";

vi.mock("next/navigation", () => ({ notFound: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

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

  /**
   * The head is the framework's to render, and its install is the site's own,
   * which no suite here loads: this pins what the site hands it for a page
   * whose metadata is generated, every tag a reader takes from the head.
   */
  it("gives /docs/tests a title, description, canonical, og:title and Markdown alternate", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "tests" }) });

    expect(metadata).toMatchObject({
      title: expect.stringMatching(/\S/),
      description: expect.stringMatching(/\S/),
      alternates: { canonical: "/docs/tests", types: { "text/markdown": "/docs/tests/index.md" } },
      openGraph: { title: expect.stringMatching(/\S/) },
    });
  });
});
