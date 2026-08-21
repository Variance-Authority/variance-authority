import type { MetadataRoute } from "next";

const SITE = process.env.SITE_URL ?? "https://variance-authority.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE, changeFrequency: "weekly", priority: 1 }];
}
