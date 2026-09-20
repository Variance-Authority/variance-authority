import type { MetadataRoute } from "next";
import { PACKAGE_DOCUMENTS } from "./content/package-docs";
import { NAVIGATION_ITEMS } from "./navigation";

const SITE = process.env.SITE_URL ?? "https://variance-authority.dev";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  "use cache";

  const landing = {
    url: new URL("/", SITE).toString(),
    changeFrequency: "weekly" as const,
    priority: 1,
  };
  const documented = NAVIGATION_ITEMS.map(({ href }) => ({
    url: new URL(href, SITE).toString(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
  const packages = PACKAGE_DOCUMENTS.map(({ name }) => ({
    url: new URL(`/reference/packages/${name}`, SITE).toString(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [
    ...new Map(
      [landing, ...documented, ...packages].map((entry) => [
        entry.url,
        entry,
      ]),
    ).values(),
  ];
}
