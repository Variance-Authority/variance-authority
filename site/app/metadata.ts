import type { Metadata } from "next";
import { markdownPath, routedDocument } from "./content/routed-docs";

export const SITE =
  process.env.SITE_URL ?? "https://variance-authority.dev";
export const SITE_NAME = "Variance Authority";
export const ROOT_TITLE = "Variance Authority — Find what varied, what caused it, and what it reached.";
export const ROOT_DESCRIPTION =
  "Visual regression you run yourself: compare a UI state against the baseline you approved, and get back the component and file:line behind every changed region.";

/** Metadata for a page in the public reading order. */
export function pageMetadata(
  path: string,
  title: string,
  description: string,
): Metadata {
  const shareTitle = `${title} — ${SITE_NAME}`;

  return {
    title,
    description,
    alternates: {
      canonical: path,
      types: routedDocument(path)
        ? { "text/markdown": markdownPath(path) }
        : undefined,
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: path,
      title: shareTitle,
      description,
      images: [],
    },
    twitter: {
      card: "summary",
      title: shareTitle,
      description,
      images: [],
    },
  };
}
