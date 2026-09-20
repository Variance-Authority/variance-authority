import { PACKAGE_DOCUMENTS } from "../content/package-docs";
import { SITE } from "../metadata";
import { NAVIGATION_ITEMS } from "../navigation";

export const revalidate = 3600;

interface Entry {
  readonly url: string;
  readonly changeFrequency: "weekly" | "monthly";
  readonly priority: number;
}

/**
 * The index a crawler reads to learn every published URL.
 *
 * It is a route handler rather than Next's `sitemap.ts` metadata route because
 * a metadata route is answered `cache-control: public, max-age=0,
 * must-revalidate` with no CDN policy beside it, so the edge revalidates it
 * against the worker on every request. A route handler carries `revalidate`
 * like every other route here, and the edge holds it.
 */
export function GET(): Response {
  return new Response(urlset(), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function urlset(): string {
  const landing: Entry = {
    url: new URL("/", SITE).toString(),
    changeFrequency: "weekly",
    priority: 1,
  };
  const documented: readonly Entry[] = NAVIGATION_ITEMS.map(({ href }) => ({
    url: new URL(href, SITE).toString(),
    changeFrequency: "monthly",
    priority: 0.8,
  }));
  const packages: readonly Entry[] = PACKAGE_DOCUMENTS.map(({ name }) => ({
    url: new URL(`/reference/packages/${name}`, SITE).toString(),
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  const entries = [
    ...new Map(
      [landing, ...documented, ...packages].map((entry) => [entry.url, entry]),
    ).values(),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) =>
      [
        "<url>",
        `<loc>${escapeXml(entry.url)}</loc>`,
        `<changefreq>${entry.changeFrequency}</changefreq>`,
        `<priority>${entry.priority}</priority>`,
        "</url>",
      ].join("\n"),
    ),
    "</urlset>",
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
