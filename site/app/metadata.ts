import type { Metadata } from "next";
import { markdownPath, routedDocument } from "./content/routed-docs";

export const SITE =
  process.env.SITE_URL ?? "https://variance-authority.dev";
export const SITE_NAME = "Variance Authority";
export const ROOT_TITLE = "Variance Authority — Understand the code. Investigate the behavior. Check the work.";
export const ROOT_DESCRIPTION =
  "Open-source tools for developers and coding agents: source intelligence, live test inspection, test selection and reduction, UI analysis, and change verification.";

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
